export type PropType = "desk" | "meeting_chair" | "sofa";

export interface OfficeProp {
  id: string;
  type: PropType;
  tileCol: number;
  tileRow: number;
}

export interface OfficeConfig {
  props: OfficeProp[];
}
