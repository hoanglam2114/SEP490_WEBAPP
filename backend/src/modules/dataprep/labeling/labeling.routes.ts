import express from 'express';
import { DataPrepLabelingController } from './labeling.controller';

const router = express.Router();
const controller = new DataPrepLabelingController();

router.get('/samples/:sampleId/labels', (req, res) => controller.getLabelsBySample(req, res));
router.post('/samples/:sampleId/labels', (req, res) => controller.addLabel(req, res));
router.post('/labels/:labelId/votes', (req, res) => controller.voteLabel(req, res));

export default router;
