import { createContext, useContext } from "react";
import { Banner } from "@shopify/polaris";
import { useNavigate } from "react-router";

export const PLAN_RANK = { starter: 0, plus: 1, pro: 2 };

const PlanContext = createContext({
  plan: 'starter',
  isPro: false,
  isPlus: false,
  canUse: () => true,
});

export function PlanProvider({ isPro, children }) {
  // Map Shopify subscription to plan tier
  const plan = isPro ? 'pro' : 'starter';
  const isPlus = PLAN_RANK[plan] >= PLAN_RANK['plus'];
  const canUse = (minPlan) => PLAN_RANK[plan] >= (PLAN_RANK[minPlan] ?? 0);

  return (
    <PlanContext.Provider value={{ plan, isPro, isPlus, canUse }}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  return useContext(PlanContext);
}

export function ProUpgradeBanner({ minPlan = 'plus' }) {
  const navigate = useNavigate();
  const planLabel = minPlan === 'pro' ? 'Pro' : 'Plus';
  return (
    <Banner
      title={`This feature requires Brix ${planLabel}`}
      tone="warning"
      action={{ content: 'Upgrade to unlock', onAction: () => navigate('/app/subscribe') }}
    >
      Upgrade to {planLabel} to unlock this feature.
    </Banner>
  );
}
