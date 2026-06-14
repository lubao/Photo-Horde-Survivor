#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GameStack } from '../lib/game-stack';

const app = new cdk.App();

new GameStack(app, 'PhotoHordeSurvivorStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT ?? '253988640130',
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Photo Horde Survivor - AI-generated horde survivor game (Bedrock Nova Canvas)',
});

app.synth();
