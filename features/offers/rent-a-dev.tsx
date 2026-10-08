import { Badge } from '@/components/ui/badge';

/** What the badge says, and what it means (its title). */
export const RENT_A_DEV = {
  label: 'Rent-a-dev',
  title: "A software house or body leasing firm: you'd be hired out to its client's project",
};

/**
 * A job at a software house, an outsourcing / staffing firm or an agency that would hire you out to a
 * client (body leasing): the AI says so with its verdict, an application can have its own call on it.
 */
export function RentADev() {
  return (
    <Badge variant="warning-soft" className="cursor-help" title={RENT_A_DEV.title}>
      {RENT_A_DEV.label}
    </Badge>
  );
}
