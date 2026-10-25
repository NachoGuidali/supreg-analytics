// Íconos de trazo, 20px, heredan el color del texto.
const base = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export const OverviewIcon = () => (
  <svg {...base}><rect x="3" y="3" width="6" height="7" rx="1.5" /><rect x="11" y="3" width="6" height="4" rx="1.5" /><rect x="11" y="9" width="6" height="8" rx="1.5" /><rect x="3" y="12" width="6" height="5" rx="1.5" /></svg>
);
export const BuilderIcon = () => (
  <svg {...base}><path d="M4 5h7M15 5h1M4 10h2M10 10h6M4 15h9M17 15h-1" /><circle cx="13" cy="5" r="2" /><circle cx="8" cy="10" r="2" /><circle cx="15" cy="15" r="2" /></svg>
);
export const SavedIcon = () => (
  <svg {...base}><path d="M6 3h8a1 1 0 0 1 1 1v13l-5-3.5L5 17V4a1 1 0 0 1 1-1Z" /></svg>
);
export const LiveIcon = () => (
  <svg {...base}><path d="M2 10h3l2-5 3 10 2.5-7 1.5 2H18" /></svg>
);
export const InstallIcon = () => (
  <svg {...base}><path d="m7 6-4 4 4 4M13 6l4 4-4 4M11 4 9 16" /></svg>
);
export const SystemIcon = () => (
  <svg {...base}><rect x="2.5" y="3.5" width="15" height="10" rx="1.5" /><path d="M7 17h6M10 13.5V17" /></svg>
);
export const SunIcon = () => (
  <svg {...base}><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3" /></svg>
);
export const MoonIcon = () => (
  <svg {...base}><path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z" /></svg>
);
export const TrendIcon = () => (
  <svg {...base}><path d="M3 15l4.5-5 3 3L17 6" /><path d="M13 6h4v4" /></svg>
);
export const FunnelIcon = () => (
  <svg {...base}><path d="M3 4h14l-5 6.5V16l-4-1.5v-4Z" /></svg>
);
export const RetentionIcon = () => (
  <svg {...base}><rect x="3" y="3" width="4" height="4" rx="1" /><rect x="8" y="3" width="4" height="4" rx="1" /><rect x="13" y="3" width="4" height="4" rx="1" /><rect x="3" y="8" width="4" height="4" rx="1" /><rect x="8" y="8" width="4" height="4" rx="1" /><rect x="3" y="13" width="4" height="4" rx="1" /></svg>
);
export const RankingIcon = () => (
  <svg {...base}><path d="M4 5h12M4 10h8M4 15h5" /></svg>
);
export const NumberIcon = () => (
  <svg {...base}><path d="M7 3 5.5 17M14.5 3 13 17M3.5 7.5h13M3 12.5h13" /></svg>
);
export const LogoutIcon = () => (
  <svg {...base}><path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 14l4-4-4-4M16 10H8" /></svg>
);
export const ChevronIcon = () => (
  <svg {...base} width={16} height={16}><path d="m6 8 4 4 4-4" /></svg>
);
export const TeamIcon = () => (
  <svg {...base}><circle cx="7.5" cy="7" r="2.6" /><path d="M2.8 16a4.7 4.7 0 0 1 9.4 0" /><circle cx="14" cy="7.8" r="2.1" /><path d="M13.2 12.2A4 4 0 0 1 17.6 16" /></svg>
);
export const ClientsIcon = () => (
  <svg {...base}><rect x="3" y="6" width="14" height="11" rx="1.5" /><path d="M7.5 6V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V6M3 11h14" /></svg>
);
export const AccountIcon = () => (
  <svg {...base}><circle cx="10" cy="7" r="3" /><path d="M4 17a6 6 0 0 1 12 0" /></svg>
);
export const PlusIcon = () => (
  <svg {...base} width={16} height={16}><path d="M10 4v12M4 10h12" /></svg>
);
export const HomeIcon = () => (
  <svg {...base}><path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3v-5h-5v5h-3a1 1 0 0 1-1-1Z" /></svg>
);
export const AcquisitionIcon = () => (
  <svg {...base}><path d="M3 4h4l3 6-3 6H3M10 10h7M14 7l3 3-3 3" /></svg>
);
export const BehaviorIcon = () => (
  <svg {...base}><path d="m5 3 10 6-4.5 1.2L8.5 15Z" /><path d="M11 11.5 15 16" /></svg>
);
export const AudienceIcon = () => (
  <svg {...base}><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2.2 2.8 4.5 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.5-2.8-7S8 5.2 10 3Z" /></svg>
);
export const InsightsIcon = () => (
  <svg {...base}><path d="M10 2.5v2M4.7 4.7l1.4 1.4M15.3 4.7l-1.4 1.4M7.5 14.5h5M8 17h4M10 6.5a4 4 0 0 0-2.5 7.1V14.5h5v-.9A4 4 0 0 0 10 6.5Z" /></svg>
);
export const DashboardIcon = () => (
  <svg {...base}><rect x="3" y="3" width="6" height="7" rx="1.5" /><rect x="11" y="3" width="6" height="4" rx="1.5" /><rect x="11" y="9" width="6" height="8" rx="1.5" /><rect x="3" y="12" width="6" height="5" rx="1.5" /></svg>
);
export const CaptureIcon = () => (
  <svg {...base}><circle cx="10" cy="10" r="6.5" /><circle cx="10" cy="10" r="2.5" /><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" /></svg>
);
export const GoalIcon = () => (
  <svg {...base}><path d="M5 17V3.5M5 4h9l-2 3 2 3H5" /></svg>
);
export const EventsIcon = () => (
  <svg {...base}><path d="M4 5h12M4 10h12M4 15h7" /><circle cx="15" cy="15" r="1.5" /></svg>
);
export const HelpIcon = () => (
  <svg {...base}><circle cx="10" cy="10" r="7" /><path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M10 14h.01" /></svg>
);
export const PlanIcon = () => (
  <svg {...base}><rect x="2.5" y="5" width="15" height="10" rx="1.5" /><path d="M2.5 8.5h15M5.5 12h3" /></svg>
);
