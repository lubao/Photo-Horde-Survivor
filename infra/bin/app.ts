#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GameStack } from '../lib/game-stack';

const app = new cdk.App();

// Region is pinned (and overridable via DEPLOY_REGION) because the surrounding
// shell may set AWS_REGION to a different region than the one where Bedrock
// Nova Canvas access is enabled. The account is taken from the deployer's
// credentials (CDK_DEFAULT_ACCOUNT) so it is never hardcoded in the repo.
const region = process.env.DEPLOY_REGION ?? 'us-east-1';
const account = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;

new GameStack(app, 'PhotoHordeSurvivorStack', {
  env: { account, region },
  description: 'Photo Horde Survivor - AI-generated horde survivor game (Bedrock Nova Canvas)',
});

app.synth();
