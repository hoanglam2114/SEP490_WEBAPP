import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, ThumbsUp } from 'lucide-react';
import { apiService } from '../services/api';

type PublicProject = {
  id: string;
  projectName: string;
  versionName: string;
  ownerId: string;
  ownerName: string;
  updatedAt: string;
  topLabel: {
    _id: string;
    name: string;
    type: 'hard' | 'soft';
    upvoteCount: number;
  } | null;
};

function formatDateTime(value?: string): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

export const PublicProjectsHub: React.FC = () => {
  const navigate = useNavigate();

  const hubQuery = useQuery<{ projects: PublicProject[] }>({
    queryKey: ['public-projects-hub'],
    queryFn: () => apiService.getPublicProjectsHub(),
  });

  const projects = hubQuery.data?.projects || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Community Hub</h1>
              <p className="text-xs text-slate-500">Explore public projects and jump straight to Data Labeling.</p>
            </div>
          </div>
          <button
            onClick={() => hubQuery.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {hubQuery.isLoading && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading public projects...</div>
        )}

        {!hubQuery.isLoading && projects.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">No public projects found.</div>
        )}

        {!hubQuery.isLoading && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {projects.map((project) => (
              <article key={project.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="space-y-2">
                  <h2 className="text-base font-semibold text-slate-900 break-words">{project.projectName}</h2>
                  <p className="text-xs text-slate-500">Version: <span className="font-semibold text-slate-700">{project.versionName}</span></p>
                  <p className="text-sm text-slate-600">Owner: <span className="font-medium text-slate-800">{project.ownerName}</span></p>
                  <p className="text-xs text-slate-500">Updated: {formatDateTime(project.updatedAt)}</p>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 mt-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Top Label</p>
                    {project.topLabel ? (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">{project.topLabel.name}</span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5">
                          <ThumbsUp className="w-3 h-3" />
                          {project.topLabel.upvoteCount}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">No labels yet</p>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <button
                    onClick={() => navigate(`/project/${project.id}/labeling`)}
                    className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-3 py-2"
                  >
                    Open
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
