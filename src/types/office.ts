export type PropType = "desk" | "meeting_chair" | "sofa" | "lounge_table" | "meeting_table" | "plant" | "bookshelf" | "whiteboard";

export interface OfficeProp {
  id: string;
  type: PropType;
  tileCol: number;
  tileRow: number;
}

export interface OfficeConfig {
  props: OfficeProp[];
}
