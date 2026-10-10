export type CompanyMemberRole = "owner" | "admin" | "member";

export interface Company {
  id: string;
  ownerId: string;
  name: string;
  country: string;
  currency: string;
  monthlyInvoiceVolume: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyProfile {
  id: string;
  legalName: string;
  tradeName: string;
  legalForm: string;
  siret: string;
  siren: string;
  vatNumber: string;
  industry: string;
  country: string;
  address: string;
  addressComplement: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  currency: string;
  registrationNumber: string;
}
