// Goal names shared by the server and the cérebro CLI (bin/cerebro.js). Kept
// free of imports: the CLI runs on every cérebro action and loading
// content-central.js (and jimp through it) cost ~1.4 s per call.
export const CONTENT_GOAL_LABELS = {
  sell_products: 'Vender produtos',
  sell_services: 'Vender serviços',
  promotions: 'Divulgar promoções',
  whatsapp_orders: 'Receber pedidos no WhatsApp',
  leads: 'Gerar leads',
  authority: 'Gerar autoridade',
  brand_awareness: 'Aumentar reconhecimento da marca',
  relationship: 'Criar relacionamento',
  engagement: 'Aumentar engajamento',
  events: 'Divulgar eventos',
  show_products: 'Mostrar produtos',
  education: 'Educar o público',
};

export const goalName = (key) => (key === 'sales' ? 'Venda' : CONTENT_GOAL_LABELS[key] || key);

export function slotTag(slot) {
  if (slot.source === 'offer') return 'venda';
  if (slot.source === 'goal') return goalName(slot.goalKey);
  return slot.source || 'assunto';
}
