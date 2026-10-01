import { Engine as BaseEngine } from './Engine.js';
import { withEnergySaving } from './render/withEnergySaving.js';

export const Engine = withEnergySaving(BaseEngine);
