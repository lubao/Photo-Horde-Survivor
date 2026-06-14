import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { GameStack } from '../lib/game-stack';

function synth() {
  const app = new cdk.App();
  const stack = new GameStack(app, 'TestStack', {
    env: { account: '253988640130', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

const template = synth();

test('synthesizes three DynamoDB tables', () => {
  template.resourceCountIs('AWS::DynamoDB::Table', 3);
});

test('generations table has a gallery GSI and scores table a score GSI', () => {
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    GlobalSecondaryIndexes: Match.arrayWith([
      Match.objectLike({ IndexName: 'gallery-index' }),
    ]),
  });
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    GlobalSecondaryIndexes: Match.arrayWith([
      Match.objectLike({ IndexName: 'score-index' }),
    ]),
  });
});

test('all S3 buckets block public access', () => {
  const buckets = template.findResources('AWS::S3::Bucket');
  const ids = Object.keys(buckets);
  assert.equal(ids.length, 3);
  for (const id of ids) {
    assert.deepEqual(
      buckets[id].Properties.PublicAccessBlockConfiguration,
      {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    );
  }
});

test('uploads bucket has a 7-day expiry lifecycle rule', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    LifecycleConfiguration: {
      Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: 7, Status: 'Enabled' })]),
    },
  });
});

test('creates a Cognito user pool, client and hosted UI domain', () => {
  template.resourceCountIs('AWS::Cognito::UserPool', 1);
  template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  template.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
});

test('HTTP API has a JWT authorizer', () => {
  template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
    AuthorizerType: 'JWT',
  });
});

test('worker lambda has a 300s timeout and bedrock invoke permission', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Timeout: 300,
    MemorySize: 1024,
  });
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'bedrock:InvokeModel' }),
      ]),
    },
  });
});

test('one CloudFront distribution with api + assets behaviors', () => {
  template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  const dists = template.findResources('AWS::CloudFront::Distribution');
  const dist = Object.values(dists)[0] as any;
  const patterns = (dist.Properties.DistributionConfig.CacheBehaviors || []).map(
    (b: any) => b.PathPattern,
  );
  assert.ok(patterns.includes('api/*'), `expected api/* behavior, got ${patterns}`);
  assert.ok(patterns.includes('assets/*'), `expected assets/* behavior, got ${patterns}`);
});

test('eight lambda functions are created', () => {
  // health, uploadUrl, status, scores, gallery, worker, generate, select
  // (plus CDK custom-resource lambdas for bucket auto-delete / deployment).
  const fns = template.findResources('AWS::Lambda::Function');
  assert.ok(Object.keys(fns).length >= 8);
});

test('WAF web ACL (CLOUDFRONT) with rate limit is attached to the distribution', () => {
  template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  template.hasResourceProperties('AWS::WAFv2::WebACL', {
    Scope: 'CLOUDFRONT',
    Rules: Match.arrayWith([
      Match.objectLike({
        Statement: Match.objectLike({
          RateBasedStatement: Match.objectLike({ AggregateKeyType: 'IP' }),
        }),
      }),
    ]),
  });
  const dists = template.findResources('AWS::CloudFront::Distribution');
  const dist = Object.values(dists)[0] as any;
  assert.ok(dist.Properties.DistributionConfig.WebACLId, 'distribution has WebACLId');
});

test('HTTP API stage has throttling and CORS is not wildcard', () => {
  template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
    DefaultRouteSettings: Match.objectLike({
      ThrottlingBurstLimit: 20,
      ThrottlingRateLimit: 50,
    }),
  });
  const apis = template.findResources('AWS::ApiGatewayV2::Api');
  const api = Object.values(apis)[0] as any;
  const origins = api.Properties.CorsConfiguration.AllowOrigins;
  assert.ok(!origins.includes('*'), `CORS must not be wildcard, got ${origins}`);
});
