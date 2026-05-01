import express from 'express';
import { ClassificationController } from './classification.controller';

const router = express.Router({ mergeParams: true });
const controller = new ClassificationController();

router.post('/classify', (req, res) => controller.classify(req, res));
router.get('/', (req, res) => controller.getClassifiedSamples(req, res));

export default router;
