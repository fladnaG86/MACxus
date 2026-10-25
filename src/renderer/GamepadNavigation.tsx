import { useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { installGamepadNavigation } from './gamepad-navigation';

export function GamepadNavigation({ back, page }: { back: () => void; page: (delta: number) => void }) {
  const { t } = useI18n();
  const callbacks = useRef({ back, page }); callbacks.current = { back, page };
  const [active, setActive] = useState(false);
  useEffect(() => installGamepadNavigation(window, {
    mode: setActive, back: () => callbacks.current.back(), page: delta => callbacks.current.page(delta),
  }), []);
  return active ? <div className="gamepad-hints" aria-label={t("Gamepad controls")}>
    <span>{t("D-pad / L stick: Move")}</span><span>{t("A: Select")}</span><span>{t("B: Back")}</span><span>{t("X: Options")}</span>
    <span>{t("LB / RB: Pages")}</span><span>{t("R stick: Scroll")}</span><span>{t("Steam + X: Keyboard")}</span>
  </div> : null;
}
