import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, ThumbsUp } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuthStore } from '../store/authStore';

type PublicProject = {
  id: string;
  projectName: string;
  versionName: string;
  ownerId: string;
  ownerName: string;
  accessType?: 'public' | 'assigned' | 'owned';
  updatedAt: string;
  topLabel: {
    _id: string;
    name: string;
    type: 'hard' | 'soft';
    assignedUserCount: number;
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
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const [activeTab, setActiveTab] = useState<'accessible' | 'owned'>('accessible');
  const currentUserId = String(user?.id || '');

  const hubQuery = useQuery<{ projects: PublicProject[] }>({
    queryKey: ['public-projects-hub', currentUserId],
    queryFn: () => apiService.getPublicProjectsHub(),
    enabled: Boolean(currentUserId && token),
  });

  const projects = hubQuery.data?.projects || [];
  const accessibleProjects = projects.filter((project) => project.accessType !== 'owned');
  const ownedProjects = projects.filter((project) => project.accessType === 'owned');
  const visibleProjects = activeTab === 'owned' ? ownedProjects : accessibleProjects;
  const emptyMessage = activeTab === 'owned'
    ? 'No owned datasets available.'
    : 'No public or assigned projects found.';

  const accessBadgeClass = (accessType?: PublicProject['accessType']) => {
    if (accessType === 'assigned') return 'border-violet-200 bg-violet-50 text-violet-700';
    if (accessType === 'owned') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  };

  const accessBadgeLabel = (accessType?: PublicProject['accessType']) => {
    if (accessType === 'assigned') return 'Assigned';
    if (accessType === 'owned') return 'Owned';
    return 'Public';
  };

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
              <p className="text-xs text-slate-500">Explore public or assigned projects and jump straight to Data Labeling.</p>
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
        <div className="mb-5 inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('accessible')}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === 'accessible'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            Public / Assigned
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
              activeTab === 'accessible' ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'
            }`}
            >
              {accessibleProjects.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('owned')}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === 'owned'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            My Assignments
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
              activeTab === 'owned' ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'
            }`}
            >
              {ownedProjects.length}
            </span>
          </button>
        </div>

        {hubQuery.isLoading && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading projects...</div>
        )}

        {!token && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">Sign in to view Community Hub projects.</div>
        )}

        {token && !hubQuery.isLoading && visibleProjects.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">{emptyMessage}</div>
        )}

        {token && !hubQuery.isLoading && visibleProjects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleProjects.map((project) => (
              <article key={project.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="space-y-2">
                  <h2 className="text-base font-semibold text-slate-900 break-words">{project.projectName}</h2>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">Version: <span className="font-semibold text-slate-700">{project.versionName}</span></p>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${accessBadgeClass(project.accessType)}`}
                    >
                      {accessBadgeLabel(project.accessType)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">Owner: <span className="font-medium text-slate-800">{project.ownerName}</span></p>
                  <p className="text-xs text-slate-500">Updated: {formatDateTime(project.updatedAt)}</p>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 mt-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Top Label</p>
                    {project.topLabel ? (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">{project.topLabel.name}</span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5">
                          <ThumbsUp className="w-3 h-3" />
                          {project.topLabel.assignedUserCount}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">No labels yet</p>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <button
                    onClick={() => navigate(`/project/${project.id}/labeling`, {
                      state: project.accessType === 'owned' ? { communityHubMode: 'owned' } : undefined,
                    })}
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
