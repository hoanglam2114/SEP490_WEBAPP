import express from 'express';
import { DataPrepPreprocessingController } from './preprocessing.controller';

const controller = new DataPrepPreprocessingController();

export const versionPreprocessingRouter = express.Router({ mergeParams: true });
versionPreprocessingRouter.post('/visualize', (req, res) => controller.visualize(req, res));
versionPreprocessingRouter.post('/cluster', (req, res) => controller.cluster(req, res));
versionPreprocessingRouter.post('/filter', (req, res) => controller.filter(req, res));
versionPreprocessingRouter.post('/remove-noise', (req, res) => controller.removeNoise(req, res));
versionPreprocessingRouter.post('/deduplicate', (req, res) => controller.deduplicate(req, res));

export const preprocessingRouter = express.Router();
preprocessingRouter.delete('/cache', (req, res) => controller.clearCache(req, res));
