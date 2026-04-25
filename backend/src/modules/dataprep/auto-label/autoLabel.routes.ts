import express from 'express';
import { AutoLabelingController } from './autoLabel.controller';

const router = express.Router({ mergeParams: true });
const controller = new AutoLabelingController();

router.post('/preview', (req, res) => controller.preview(req, res));
router.post('/save', (req, res) => controller.save(req, res));

export default router;
