/**
 * TNM Accounts — Global T&M staffing accounts.
 * SI = System Integrator / partner we sub through.
 * End Client = the account signs directly with us.
 * status prospect until the salesperson converts them.
 */

export type TnmEntity = 'SI' | 'End Client';
export type TnmWorkType = 'Project SOW' | 'Client';
export type TnmRegion = 'USA' | 'India' | 'Other';
export type TnmStatus = 'prospect' | 'active' | 'inactive';

export interface TnmAccount {
  id: string;
  name: string;
  entity: TnmEntity;
  workType: TnmWorkType | null;
  region: TnmRegion;
  status: TnmStatus;
  keyContact: string | null;
  staffingConsultant: string | null;
  ownerNote: string | null;
  notes: string | null;
  createdBy: string | null;
  /** Set when this prospect has been promoted to a us_staffing_accounts row. */
  promotedToUsId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TnmAccountContact {
  id: string;
  accountId: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TNM_ENTITY_OPTIONS: TnmEntity[] = ['SI', 'End Client'];
export const TNM_WORK_TYPE_OPTIONS: TnmWorkType[] = ['Project SOW', 'Client'];
export const TNM_REGION_OPTIONS: TnmRegion[] = ['USA', 'India', 'Other'];
export const TNM_STATUS_OPTIONS: TnmStatus[] = ['prospect', 'active', 'inactive'];
