import express from 'express';
import { QualityController } from './quality.controller';

const router = express.Router({ mergeParams: true });
const controller = new QualityController();

router.get('/labeling-status', (req, res) => controller.getLabelingStatus(req, res));
router.patch('/incomplete-bucket', (req, res) => controller.updateIncompleteBucket(req, res));
router.post('/classify', (req, res) => controller.classify(req, res));
router.get('/', (req, res) => controller.getQualitySamples(req, res));

export default router;
