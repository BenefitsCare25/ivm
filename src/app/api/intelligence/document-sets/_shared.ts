export const ITEMS_INCLUDE = {
  items: {
    include: {
      documentType: { select: { id: true, name: true } },
    },
  },
} as const;
