/**
 * ui/ — the shared primitive library for the unified design language.
 * Every surface imports from here instead of rolling its own button /
 * input / card / badge. Built on the token contract (tokens.scss +
 * global.scss) so all themes (incl. cinematic) re-skin for free.
 */
export { Button } from './Button/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button/Button';

export { Input, Textarea, Select, Field } from './controls/Controls';
export type { InputProps, TextareaProps, SelectProps, FieldProps } from './controls/Controls';

export { ComboList } from './ComboList/ComboList';
export type { ComboListOption, ComboListProps } from './ComboList/ComboList';

export { SegmentedControl } from './SegmentedControl/SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl/SegmentedControl';

export { Panel, Card, Divider, SectionLabel } from './Surface/Surface';

export { StatusDot, StatusBadge, Chip, Spinner, RecDot } from './Status/Status';
export type { RunStatus } from './Status/Status';
