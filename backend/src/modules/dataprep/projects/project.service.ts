import mongoose from 'mongoose';
import { DataPrepProject } from '../../../models/DataPrepProject';
import { DatasetVersion } from '../../../models/DatasetVersion';

export class DataPrepProjectService {
  async listProjects(ownerId: string) {
    const projects = await DataPrepProject.find({
      ownerId: new mongoose.Types.ObjectId(ownerId),
      isArchived: { $ne: true },
    })
      .sort({ updatedAt: -1 })
      .lean();

    return projects;
  }

  async getProjectById(projectId: string, ownerId: string) {
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return null;
    }

    return DataPrepProject.findOne({
      _id: new mongoose.Types.ObjectId(projectId),
      ownerId: new mongoose.Types.ObjectId(ownerId),
      isArchived: { $ne: true },
    }).lean();
  }

  async listVersions(projectId: string, ownerId: string) {
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return [];
    }

    return DatasetVersion.find({
      projectId: new mongoose.Types.ObjectId(projectId),
      ownerId: new mongoose.Types.ObjectId(ownerId),
    })
      .sort({ versionNo: -1, createdAt: -1 })
      .lean();
  }
}
