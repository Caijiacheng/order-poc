type FeedbackBannerProps = {
  kind: "success" | "error";
  message: string;
};

export function FeedbackBanner({ kind, message }: FeedbackBannerProps) {
  if (!message) {
    return null;
  }

  if (kind === "success") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {message}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </div>
  );
}
