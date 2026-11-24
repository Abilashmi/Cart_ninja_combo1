import { createContext, useContext } from "react";
import { Banner } from "@shopify/polaris";
import { useNavigate } from "react-router";
import {
  PLANS,
  PLAN_KEYS,
  getFeatureState as configGetFeatureState,
  canAccessFeature as configCanAccessFeature,
  canPublishFeature as configCanPublishFeature,
  canPreviewFeature as configCanPreviewFeature,
  getMinPlanForFeature,
} from "../config/plans";

export const PLAN_RANK = PLAN_KEYS.reduce((acc, key, i) => ({ ...acc, [key]: i }), {});

const PlanContext = createContext({
  plan: 'free',
  canUse: () => true,
  getFeatureState: () => 'enabled',
  canAccessFeature: () => true,
  canPublishFeature: () => true,
  canPreviewFeature: () => false,
});

export function PlanProvider({ plan, children }) {
  const planKey = PLANS[plan] ? plan : 'free';
  const canUse = (minPlan) => (PLAN_RANK[planKey] ?? 0) >= (PLAN_RANK[minPlan] ?? 0);

  const value = {
    plan: planKey,
    isPro: planKey === 'pro',
    isStarter: (PLAN_RANK[planKey] ?? 0) >= (PLAN_RANK['starter'] ?? 0),
    canUse,
    getFeatureState: (featureKey) => configGetFeatureState(planKey, featureKey),
    canAccessFeature: (featureKey) => configCanAccessFeature(planKey, featureKey),
    canPublishFeature: (featureKey) => configCanPublishFeature(planKey, featureKey),
    canPreviewFeature: (featureKey) => configCanPreviewFeature(planKey, featureKey),
  };

  return (
    <PlanContext.Provider value={value}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  return useContext(PlanContext);
}

export function ProUpgradeBanner({ minPlan = 'starter', featureKey }) {
  const navigate = useNavigate();
  const requiredPlan = featureKey ? (getMinPlanForFeature(featureKey) || minPlan) : minPlan;
  const planLabel = PLANS[requiredPlan]?.label || 'Starter';
  return (
    <Banner
      title={`This feature requires the ${planLabel} plan`}
      tone="warning"
      action={{ content: 'Upgrade to unlock', onAction: () => navigate('/app/subscribe') }}
    >
      Upgrade to {planLabel} to unlock this feature.
    </Banner>
  );
}
