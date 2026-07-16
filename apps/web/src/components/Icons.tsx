import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    ...props,
  };
}

export function IconLibrary(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v12.5" />
      <path d="M6.5 4A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H20" />
      <path d="M8 8h8M8 12h6" />
    </svg>
  );
}

export function IconProviders(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </svg>
  );
}

export function IconJobs(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M8 12h8M8 16h5" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6.5" y="5.5" width="3.5" height="13" rx="0.8" fill="currentColor" stroke="none" />
      <rect x="14" y="5.5" width="3.5" height="13" rx="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconVolume(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10h3.2L12 6.5v11L7.2 14H4v-4Z" fill="currentColor" stroke="none" />
      <path d="M15 9.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M17.2 7a5.5 5.5 0 0 1 0 10" />
    </svg>
  );
}

export function IconVolumeMute(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10h3.2L12 6.5v11L7.2 14H4v-4Z" fill="currentColor" stroke="none" />
      <path d="M16 10l4 4M20 10l-4 4" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16.5 16.5 21 21" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconWave(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12h2l2-6 3 12 3-9 2 5h6" />
    </svg>
  );
}

export function IconBack(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 6 9 12l6 6" />
    </svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 7V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1" />
      <path d="M15 12H3m0 0 3-3m-3 3 3 3" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

export function IconViewSmall(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="4.5" height="4.5" rx="0.8" />
      <rect x="9.75" y="3.5" width="4.5" height="4.5" rx="0.8" />
      <rect x="16" y="3.5" width="4.5" height="4.5" rx="0.8" />
      <rect x="3.5" y="9.75" width="4.5" height="4.5" rx="0.8" />
      <rect x="9.75" y="9.75" width="4.5" height="4.5" rx="0.8" />
      <rect x="16" y="9.75" width="4.5" height="4.5" rx="0.8" />
      <rect x="3.5" y="16" width="4.5" height="4.5" rx="0.8" />
      <rect x="9.75" y="16" width="4.5" height="4.5" rx="0.8" />
      <rect x="16" y="16" width="4.5" height="4.5" rx="0.8" />
    </svg>
  );
}

export function IconViewStandard(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1" />
    </svg>
  );
}

export function IconViewList(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="3" height="3" rx="0.6" />
      <rect x="3.5" y="10.5" width="3" height="3" rx="0.6" />
      <rect x="3.5" y="16.5" width="3" height="3" rx="0.6" />
      <path d="M9 6h11.5M9 12h11.5M9 18h11.5" />
    </svg>
  );
}
