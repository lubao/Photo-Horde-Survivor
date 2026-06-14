import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwInteg from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

/**
 * Photo Horde Survivor infrastructure.
 *
 *  S3      : uploads (7d expiry) · assets (private) · web (static site)
 *  DynamoDB: generations (+gallery GSI) · scores (+score GSI) · quota (TTL)
 *  Cognito : user pool + hosted UI + app client; JWT authorizer on the API
 *  Lambda  : health · uploadUrl · generate · status · select · scores · gallery
 *            + async generation worker (Bedrock Nova Canvas)
 *  API GW  : HTTP API; public reads (health/scores/gallery) + JWT-protected
 *  CFront  : one distribution -> web (default), /assets/* , /api/*
 */
export class GameStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const NOVA_MODEL_ID = 'amazon.nova-canvas-v1:0';
    const DAILY_QUOTA = '10';

    // -----------------------------------------------------------------
    // S3 buckets
    // -----------------------------------------------------------------
    const uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(7) }],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    const assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const webBucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // -----------------------------------------------------------------
    // DynamoDB tables
    // -----------------------------------------------------------------
    const generationsTable = new dynamodb.Table(this, 'GenerationsTable', {
      partitionKey: { name: 'generationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });
    // Gallery query: only opted-in items set galleryPublic='Y', newest first.
    generationsTable.addGlobalSecondaryIndex({
      indexName: 'gallery-index',
      partitionKey: { name: 'galleryPublic', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'completedAt', type: dynamodb.AttributeType.STRING },
    });

    const scoresTable = new dynamodb.Table(this, 'ScoresTable', {
      partitionKey: { name: 'board', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scoreId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    // Leaderboard query: top scores per board, numeric sort descending.
    scoresTable.addGlobalSecondaryIndex({
      indexName: 'score-index',
      partitionKey: { name: 'board', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'score', type: dynamodb.AttributeType.NUMBER },
    });

    const quotaTable = new dynamodb.Table(this, 'QuotaTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // -----------------------------------------------------------------
    // Cognito user pool + hosted UI + app client
    // -----------------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 8, requireDigits: true, requireLowercase: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    userPool.addDomain('HostedUI', {
      cognitoDomain: { domainPrefix: `phorde-${this.account}` },
    });

    // -----------------------------------------------------------------
    // Lambda functions
    // -----------------------------------------------------------------
    // Resolve the backend dir robustly whether this file runs from lib/
    // (ts-node via cdk) or from a compiled test output dir. Walk up until a
    // sibling "backend/handlers" directory is found.
    const findBackendDir = (): string => {
      let dir = __dirname;
      for (let i = 0; i < 6; i++) {
        const candidate = path.join(dir, 'backend');
        if (require('fs').existsSync(path.join(candidate, 'handlers'))) return candidate;
        dir = path.join(dir, '..');
      }
      return path.join(__dirname, '..', '..', 'backend');
    };
    const backendDir = findBackendDir();
    const handlersDir = path.join(backendDir, 'handlers');

    const baseEnv = {
      UPLOADS_BUCKET: uploadsBucket.bucketName,
      ASSETS_BUCKET: assetsBucket.bucketName,
      GENERATIONS_TABLE: generationsTable.tableName,
      SCORES_TABLE: scoresTable.tableName,
      QUOTA_TABLE: quotaTable.tableName,
      NOVA_MODEL_ID,
      DAILY_QUOTA,
      NODE_OPTIONS: '--enable-source-maps',
    };

    const commonFnProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: backendDir,
      depsLockFilePath: path.join(backendDir, 'package-lock.json'),
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        target: 'node20',
        minify: false,
        externalModules: [],
      },
      environment: baseEnv,
    };

    const fn = (
      logicalId: string,
      entry: string,
      opts: { timeout?: number; memory?: number; env?: Record<string, string> } = {},
    ) =>
      new NodejsFunction(this, logicalId, {
        ...commonFnProps,
        entry: path.join(handlersDir, entry),
        handler: 'handler',
        timeout: cdk.Duration.seconds(opts.timeout ?? 15),
        memorySize: opts.memory ?? 256,
        environment: { ...baseEnv, ...(opts.env ?? {}) },
      });

    const healthFn = fn('HealthFn', 'health.mjs');
    const uploadUrlFn = fn('UploadUrlFn', 'uploadUrl.mjs');
    const statusFn = fn('StatusFn', 'status.mjs');
    const scoresFn = fn('ScoresFn', 'scores.mjs');
    const galleryFn = fn('GalleryFn', 'gallery.mjs');

    // Async worker performs the slow Bedrock calls (up to ~5 min).
    const workerFn = fn('WorkerFn', 'worker.mjs', { timeout: 300, memory: 1024 });

    // Kickoff handlers need the worker function name to async-invoke it.
    const generateFn = fn('GenerateFn', 'generate.mjs', {
      env: { WORKER_FUNCTION_NAME: workerFn.functionName },
    });
    const selectFn = fn('SelectFn', 'select.mjs', {
      env: { WORKER_FUNCTION_NAME: workerFn.functionName },
    });

    // -----------------------------------------------------------------
    // Permissions
    // -----------------------------------------------------------------
    uploadsBucket.grantPut(uploadUrlFn); // presigned PUT requires role perms
    uploadsBucket.grantRead(workerFn);
    assetsBucket.grantReadWrite(workerFn);
    assetsBucket.grantRead(statusFn);
    assetsBucket.grantRead(galleryFn);

    generationsTable.grantWriteData(generateFn);
    generationsTable.grantReadWriteData(workerFn);
    generationsTable.grantReadData(statusFn);
    generationsTable.grantReadWriteData(selectFn);
    generationsTable.grantReadData(galleryFn);
    scoresTable.grantReadWriteData(scoresFn);
    quotaTable.grantReadWriteData(generateFn);

    workerFn.grantInvoke(generateFn);
    workerFn.grantInvoke(selectFn);

    workerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${NOVA_MODEL_ID}`],
      }),
    );

    // -----------------------------------------------------------------
    // HTTP API Gateway
    // -----------------------------------------------------------------
    const httpApi = new apigw.HttpApi(this, 'GameHttpApi', {
      corsPreflight: {
        allowHeaders: ['content-type', 'authorization'],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ['*'],
        maxAge: cdk.Duration.days(1),
      },
    });

    // -----------------------------------------------------------------
    // CloudFront distribution (created before the user pool client so the
    // client's callback URLs can reference the distribution domain).
    // -----------------------------------------------------------------
    const webOAI = new cloudfront.OriginAccessIdentity(this, 'WebOAI');
    webBucket.grantRead(webOAI);
    const assetsOAI = new cloudfront.OriginAccessIdentity(this, 'AssetsOAI');
    assetsBucket.grantRead(assetsOAI);

    const apiDomain = `${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`;

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(webBucket, {
          originAccessIdentity: webOAI,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        'assets/*': {
          origin: origins.S3BucketOrigin.withOriginAccessIdentity(assetsBucket, {
            originAccessIdentity: assetsOAI,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        'api/*': {
          origin: new origins.HttpOrigin(apiDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forward the Authorization header (needed by the JWT authorizer).
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    const siteUrl = `https://${distribution.distributionDomainName}`;

    const userPoolClient = userPool.addClient('WebClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [`${siteUrl}/`, 'http://localhost:8080/', 'http://localhost:8080/index.html'],
        logoutUrls: [`${siteUrl}/`, 'http://localhost:8080/'],
      },
    });

    // JWT authorizer validating Cognito access/ID tokens.
    const jwtAuthorizer = new HttpJwtAuthorizer(
      'JwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );

    // -----------------------------------------------------------------
    // Routes (public reads + JWT-protected writes/owner actions)
    // -----------------------------------------------------------------
    const integ = (idStr: string, f: lambda.IFunction) =>
      new apigwInteg.HttpLambdaIntegration(idStr, f);

    // Public
    httpApi.addRoutes({ path: '/api/health', methods: [apigw.HttpMethod.GET], integration: integ('healthI', healthFn) });
    httpApi.addRoutes({ path: '/api/scores', methods: [apigw.HttpMethod.GET], integration: integ('scoresGetI', scoresFn) });
    httpApi.addRoutes({ path: '/api/gallery', methods: [apigw.HttpMethod.GET], integration: integ('galleryI', galleryFn) });

    // Protected (JWT)
    const protectedRoute = (p: string, m: apigw.HttpMethod, f: lambda.IFunction, idStr: string) =>
      httpApi.addRoutes({ path: p, methods: [m], integration: integ(idStr, f), authorizer: jwtAuthorizer });

    protectedRoute('/api/upload-url', apigw.HttpMethod.POST, uploadUrlFn, 'uploadI');
    protectedRoute('/api/generate', apigw.HttpMethod.POST, generateFn, 'genI');
    protectedRoute('/api/generate/{id}/status', apigw.HttpMethod.GET, statusFn, 'statusI');
    protectedRoute('/api/select', apigw.HttpMethod.POST, selectFn, 'selI');
    protectedRoute('/api/scores', apigw.HttpMethod.POST, scoresFn, 'scoresPostI');

    // -----------------------------------------------------------------
    // Deploy frontend + runtime config to the web bucket
    // -----------------------------------------------------------------
    new s3deploy.BucketDeployment(this, 'DeployWeb', {
      sources: [
        s3deploy.Source.asset(path.join(backendDir, '..', 'frontend'), {
          exclude: ['test', 'test/**', 'package.json', 'node_modules', 'node_modules/**'],
        }),
        s3deploy.Source.jsonData('config.json', {
          apiBase: '/api',
          region: this.region,
          userPoolId: userPool.userPoolId,
          userPoolClientId: userPoolClient.userPoolClientId,
          hostedUiDomain: `phorde-${this.account}.auth.${this.region}.amazoncognito.com`,
          redirectUri: `${siteUrl}/`,
        }),
      ],
      destinationBucket: webBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // -----------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------
    new cdk.CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new cdk.CfnOutput(this, 'ApiEndpoint', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'HostedUiDomain', {
      value: `phorde-${this.account}.auth.${this.region}.amazoncognito.com`,
    });
    new cdk.CfnOutput(this, 'AssetsBucketName', { value: assetsBucket.bucketName });
    new cdk.CfnOutput(this, 'UploadsBucketName', { value: uploadsBucket.bucketName });
    new cdk.CfnOutput(this, 'GenerationsTableName', { value: generationsTable.tableName });
    new cdk.CfnOutput(this, 'ScoresTableName', { value: scoresTable.tableName });
  }
}
