import express from 'express';
import { QualityController } from './quality.controller';

const router = express.Router({ mergeParams: true });
const controller = new QualityController();

router.post('/classify', (req, res) => controller.classify(req, res));
router.get('/', (req, res) => controller.getQualitySamples(req, res));

export default router;
