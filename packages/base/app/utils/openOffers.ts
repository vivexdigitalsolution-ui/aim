/**
 * The One price cars still on offer: the offer has not ended, or the car has no end date because its source gives none
 * (source 'asnet', migration 63: the scrape removes it once it is no longer listed). Use on a one_price_lots query.
 */
export const openOffers = <T extends { or: (filter: string) => T }>(query: T): T =>
  query.or(`deadline.gt."${new Date().toISOString()}",and(source.eq.asnet,deadline.is.null)`)
