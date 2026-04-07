export type PropType = "desk" | "meeting_chair" | "sofa" | "lounge_table" | "meeting_table" | "plant" | "bookshelf" | "whiteboard" | "coffee_machine" | "water_cooler" | "long_sofa" | "tv" | "filing_cabinet";

export interface OfficeProp {
  id: string;
  type: PropType;
  tileCol: number;
  tileRow: number;
}

export interface OfficeConfig {
  props: OfficeProp[];
}
