type StepNavigationProps = {
  showBack?: boolean;
  showNext?: boolean;
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
};

export function StepNavigation({
  showBack,
  showNext,
  onBack,
  onNext,
  nextDisabled,
}: StepNavigationProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        {showBack && (
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 font-medium text-gray-700"
          >
            Back
          </button>
        )}
      </div>
      <div>
        {showNext && (
          <button
            onClick={onNext}
            disabled={nextDisabled}
            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white font-medium"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
