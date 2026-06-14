import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwInteg from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

/**
 * PhotoHordeSurvivor infrastructure.
 *
 * Resources:
 *  - S3 "uploads"  : raw user photos (private, lifecycle-expired)
 *  - S3 "assets"   : AI-generated game assets (private, served via CloudFront)
 *  - S3 "web"      : static frontend (served via CloudFront)
 *  - DynamoDB "generations" : tracks each generation + single-selection lock + gallery opt-in
 *  - DynamoDB "leaderboard" : high scores
 *  - Lambda x4     : generateAssets, selectAsset, scores, gallery
 *  - HTTP API Gateway -> Lambdas
 *  - CloudFront    : single distribution for web + /assets/* + /api/*
 */
export class GameStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const NOVA_MODEL_ID = 'amazon.nova-canvas-v1:0';

    // ---------------------------------------------------------------
    // Storage: S3 buckets
    // ---------------------------------------------------------------
    const uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(7) }],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
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

    // ---------------------------------------------------------------
    // Data: DynamoDB tables
    // ---------------------------------------------------------------
    const generationsTable = new dynamodb.Table(this, 'GenerationsTable', {
      partitionKey: { name: 'generationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // GSI to query public gallery items by creation time
    generationsTable.addGlobalSecondaryIndex({
      indexName: 'gallery-index',
      partitionKey: { name: 'galleryPublic', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    const leaderboardTable = new dynamodb.Table(this, 'LeaderboardTable', {
      partitionKey: { name: 'board', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scoreId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------------------------------------------------------------
    // Lambda functions
    // ---------------------------------------------------------------
    const handlersDir = path.join(__dirname, '..', '..', 'backend', 'handlers');
    const backendDir = path.join(__dirname, '..', '..', 'backend');

    const commonFnProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: backendDir,
      depsLockFilePath: path.join(backendDir, 'package-lock.json'),
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        target: 'node20',
        minify: false,
        // The Bedrock SDK client is NOT guaranteed in the Lambda runtime, so we
        // bundle ALL modules (externalModules: []) from backend/node_modules.
        externalModules: [],
      },
      environment: {
        UPLOADS_BUCKET: uploadsBucket.bucketName,
        ASSETS_BUCKET: assetsBucket.bucketName,
        GENERATIONS_TABLE: generationsTable.tableName,
        LEADERBOARD_TABLE: leaderboardTable.tableName,
        NOVA_MODEL_ID,
        NODE_OPTIONS: '--enable-source-maps',
      },
    };

    const generateFn = new NodejsFunction(this, 'GenerateAssetsFn', {
      ...commonFnProps,
      entry: path.join(handlersDir, 'generateAssets.mjs'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
    });

    const selectFn = new NodejsFunction(this, 'SelectAssetFn', {
      ...commonFnProps,
      entry: path.join(handlersDir, 'selectAsset.mjs'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    const scoresFn = new NodejsFunction(this, 'ScoresFn', {
      ...commonFnProps,
      entry: path.join(handlersDir, 'scores.mjs'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
    });

    const galleryFn = new NodejsFunction(this, 'GalleryFn', {
      ...commonFnProps,
      entry: path.join(handlersDir, 'gallery.mjs'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
    });

    // ---------------------------------------------------------------
    // Permissions
    // ---------------------------------------------------------------
    uploadsBucket.grantReadWrite(generateFn);
    assetsBucket.grantReadWrite(generateFn);
    assetsBucket.grantReadWrite(selectFn);
    generationsTable.grantReadWriteData(generateFn);
    generationsTable.grantReadWriteData(selectFn);
    generationsTable.grantReadData(galleryFn);
    leaderboardTable.grantReadWriteData(scoresFn);

    // Bedrock Nova Canvas invoke permission (image generation)
    generateFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/${NOVA_MODEL_ID}`,
        ],
      }),
    );

    // ---------------------------------------------------------------
    // HTTP API Gateway
    // ---------------------------------------------------------------
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

    const route = (
      p: string,
      method: apigw.HttpMethod,
      fn: lambda.IFunction,
      integId: string,
    ) =>
      httpApi.addRoutes({
        path: p,
        methods: [method],
        integration: new apigwInteg.HttpLambdaIntegration(integId, fn),
      });

    route('/api/generate', apigw.HttpMethod.POST, generateFn, 'genInteg');
    route('/api/select', apigw.HttpMethod.POST, selectFn, 'selInteg');
    route('/api/scores', apigw.HttpMethod.GET, scoresFn, 'scoresGetInteg');
    route('/api/scores', apigw.HttpMethod.POST, scoresFn, 'scoresPostInteg');
    route('/api/gallery', apigw.HttpMethod.GET, galleryFn, 'galleryInteg');

    // ---------------------------------------------------------------
    // CloudFront distribution (web + assets + api behind one origin)
    // ---------------------------------------------------------------
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
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_CUSTOM_ORIGIN,
        },
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    // ---------------------------------------------------------------
    // Deploy frontend static files to the web bucket
    // ---------------------------------------------------------------
    new s3deploy.BucketDeployment(this, 'DeployWeb', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'frontend'))],
      destinationBucket: webBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ---------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'ApiEndpoint', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'AssetsBucketName', { value: assetsBucket.bucketName });
    new cdk.CfnOutput(this, 'UploadsBucketName', { value: uploadsBucket.bucketName });
    new cdk.CfnOutput(this, 'GenerationsTableName', { value: generationsTable.tableName });
    new cdk.CfnOutput(this, 'LeaderboardTableName', { value: leaderboardTable.tableName });
  }
}
