"use client";

import { useRouter } from "next/navigation";
import { Stepper, type Step } from "@/components/ui/stepper";
import { SESSION_STEPS, STEP_LABELS, STEP_ROUTES, type SessionStep } from "@/types/session";

interface SessionStepperProps {
  sessionId: string;
  currentStep: SessionStep;
  sessionStatus: string;
}

function getStepStatus(
  step: SessionStep,
  currentStep: SessionStep,
  sessionStatus: string
): "completed" | "current" | "upcoming" {
  const stepIndex = SESSION_STEPS.indexOf(step);
  const currentIndex = SESSION_STEPS.indexOf(currentStep);

  if (sessionStatus === "COMPLETED" || sessionStatus === "REVIEWED") {
    return "completed";
  }

  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "current";
  return "upcoming";
}

export function SessionStepper({
  sessionId,
  currentStep,
  sessionStatus,
}: SessionStepperProps) {
  const router = useRouter();

  const steps: Step[] = SESSION_STEPS.map((step) => ({
    id: step,
    label: STEP_LABELS[step],
    status: getStepStatus(step, currentStep, sessionStatus),
  }));

  function handleStepClick(stepId: string) {
    const route = STEP_ROUTES[stepId as SessionStep];
    if (route) {
      router.push(`/sessions/${sessionId}/${route}`);
    }
  }

  return (
    <Stepper
      steps={steps}
      onStepClick={handleStepClick}
      className="mb-6"
    />
  );
}
