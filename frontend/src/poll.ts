export type PollDetail = {
  poll_id: string;
  census_root: string;
  tallier_key: [string, string];
  voting_start_time: number;
  voting_end_time: number;
  fee: string;
  platform_fee: string;
  fee_destination: string;
  description_url: string;
  census_url: string;
  tally: number[] | null;
  title: string;
  choices: string[];
};
