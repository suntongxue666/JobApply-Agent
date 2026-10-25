import { credentialFor, type Config, type Profile } from "../shared/schema";
import { DEEPSEEK } from "../shared/deepseek";
export type SetupStatus = {
  resume: boolean;
  greeting: boolean;
  model: boolean;
};
export function setupStatus(
  config: Config,
  profile: Profile | undefined,
  credential: unknown,
): SetupStatus {
  return {
    resume:
      !!profile?.confirmed &&
      !!profile.facts.length &&
      profile.text.trim().length >= 20,
    greeting: !!config.greetingConfirmed && !!config.greeting.trim(),
    model:
      !!credentialFor(credential, DEEPSEEK.origin) &&
      config.consentOrigin === DEEPSEEK.origin,
  };
}
export function setupReady(status: SetupStatus) {
  return status.resume && status.greeting && status.model;
}
