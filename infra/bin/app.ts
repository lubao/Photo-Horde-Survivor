#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GameStack } from '../lib/game-stack';

const app = new cdk.App();

// Pin the target environment. The required deployment target is fixed
// (account 253988640130, us-east-1 where Bedrock Nova Canvas access is enabled).
// Hardcoded rather than read from CDK_DEFAULT_REGION because the surrounding
// shell may set AWS_REGION to a different region.
new GameStack(app, 'PhotoHordeSurvivorStack', {
  env: {
    account: '253988640130',
    region: 'us-east-1',
  },
  description: 'Photo Horde Survivor - AI-generated horde survivor game (Bedrock Nova Canvas)',
});

app.synth();
