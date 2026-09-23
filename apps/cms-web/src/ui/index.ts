/**
 * The primitive layer.
 *
 * Everything in here is domain-free: it knows about buttons and fields, not
 * about articles, licences or the queue. That is the boundary that makes the
 * set worth having — the moment a primitive knows what a story is, it stops
 * being reusable and starts being a screen with the wrong name.
 *
 * Screens import from here; nothing in here imports from a screen.
 */

export { Badge, Flag, LangTag, type BadgeTone, type FlagTone } from './Badge';
export { Banner, type BannerTone } from './Banner';
export { Breadcrumbs, type Crumb } from './Breadcrumbs';
export { Button, LinkButton, type ButtonProps, type LinkButtonProps } from './Button';
export { Combobox, type ComboOption } from './Combobox';
export { EmptyState } from './EmptyState';
export { Counter, Field, Fieldset, type FieldControlProps } from './Field';
export { FileDrop } from './FileDrop';
export { Icon, type IconName } from './Icon';
export { Pagination } from './Pagination';
export { Panel } from './Panel';
export { SearchInput } from './SearchInput';
export { Segmented, ToggleGroup, type Option } from './Segmented';
export { Select, type SelectProps } from './Select';
export { Skeleton } from './Skeleton';
export { Spinner } from './Spinner';
export { TabPanel, Tabs, panelId, tabId, type TabDef } from './Tabs';
