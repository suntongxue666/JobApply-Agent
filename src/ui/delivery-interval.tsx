import { deliveryIntervals, type DeliveryInterval } from "../shared/interval";
export function DeliveryIntervalControl({
  enabled,
  range,
  disabled,
  onChange,
}: {
  enabled: boolean;
  range: DeliveryInterval;
  disabled?: boolean;
  onChange: (enabled: boolean, range: DeliveryInterval) => void;
}) {
  return (
    <div className="delivery-interval">
      <div className="delivery-interval-row">
        <label className="check">
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked, range)}
          />
          投递时间间隔
        </label>
        <div className="delivery-interval-select">
          <select
            aria-label="选择投递时间间隔"
            value={range}
            disabled={disabled || !enabled}
            onChange={(e) =>
              onChange(enabled, e.target.value as DeliveryInterval)
            }
          >
            {Object.entries(deliveryIntervals).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
          <svg
            className="interval-chevron"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>
      <small>每次发送成功后，按所选范围等待，再处理下一岗。</small>
    </div>
  );
}
