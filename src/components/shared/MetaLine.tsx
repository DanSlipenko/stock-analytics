import React from "react";

/* Secondary text joined with " · ". Each part stays whole; lines only break after a separator. */
export default function MetaLine({ parts, className }: { parts: string[]; className?: string }) {
  return (
    <p className={className}>
      {parts.map((part, index) => (
        <React.Fragment key={part}>
          {index > 0 && " · "}
          <span className="whitespace-nowrap">{part}</span>
        </React.Fragment>
      ))}
    </p>
  );
}
