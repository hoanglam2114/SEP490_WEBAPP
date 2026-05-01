import express from 'express';
import { DataPrepLabelingController } from './labeling.controller';
import { MessageAutoLabelingController } from './messageAutoLabel.controller';

const router = express.Router();
const controller = new DataPrepLabelingController();
const messageAutoLabelController = new MessageAutoLabelingController();

router.get('/samples/:sampleId/labels', (req, res) => controller.getLabelsBySample(req, res));
router.post('/samples/:sampleId/labels', (req, res) => controller.addLabel(req, res));
router.post('/samples/:sampleId/message-auto-label/preview', (req, res) => messageAutoLabelController.preview(req, res));
router.post('/samples/:sampleId/message-auto-label/save', (req, res) => messageAutoLabelController.save(req, res));
router.post('/labels/:labelId/votes', (req, res) => controller.voteLabel(req, res));

export default router;
