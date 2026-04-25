import express from 'express';
import { DataPrepProjectController } from './project.controller';

const router = express.Router();
const controller = new DataPrepProjectController();

router.get('/', (req, res) => controller.listProjects(req, res));
router.get('/:projectId', (req, res) => controller.getProject(req, res));
router.get('/:projectId/versions', (req, res) => controller.listVersions(req, res));

export default router;
