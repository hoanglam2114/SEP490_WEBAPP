import { StepNavigation } from '../../../components/StepNavigation';
import { SystemPromptPage } from '../../../pages/SystemPromptPage';

type SelectedPromptPayload = {
  content: string;
  promptId: string;
  systemPromptVersion: string;
};

type SystemPromptStepPanelProps = {
  systemPromptText: string;
  onSystemPromptTextChange: (value: string) => void;
  previewJson: Record<string, any> | null;
  projectName: string;
  onSelectedPromptVersionChange: (payload: SelectedPromptPayload) => void;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

export function SystemPromptStepPanel({
  systemPromptText,
  onSystemPromptTextChange,
  previewJson,
  projectName,
  onSelectedPromptVersionChange,
  onBack,
  onNext,
  nextDisabled,
}: SystemPromptStepPanelProps) {
  return (
    <div className="space-y-5">
      <SystemPromptPage
        systemPromptText={systemPromptText}
        onSystemPromptTextChange={onSystemPromptTextChange}
        previewJson={previewJson}
        projectName={projectName}
        onSelectedPromptVersionChange={onSelectedPromptVersionChange}
      />

      <StepNavigation showBack showNext onBack={onBack} onNext={onNext} nextDisabled={nextDisabled} />
    </div>
  );
}
