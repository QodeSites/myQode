/* ---------------------------
   Reusable Modal Component
---------------------------- */
function ModalShell({
  title,
  onClose,
  children,
  size = "md", // "sm" | "md" | "lg"
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass =
    size === "lg"
      ? "sm:max-w-xl md:max-w-2xl lg:max-w-3xl"
      : size === "sm"
        ? "sm:max-w-sm md:max-w-md"
        : "sm:max-w-md md:max-w-lg";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full ${sizeClass} bg-card shadow-2xl
          h-[100dvh] sm:h-auto sm:rounded-lg
          flex flex-col max-h-[90dvh] mt-4 lg:mt-14`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between p-4 border-b border-border flex-none ">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-md" aria-label="Close modal">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto overscroll-contain flex-1">{children}</div>
      </div>
    </div>
  );
}

export default ModalShell;