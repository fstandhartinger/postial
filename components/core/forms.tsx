"use client";
import { useActionState, useState } from "react";
import { TimezoneSelect } from './timezone-select';
import { coreAction } from "@/app/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
export function ActionForm({
  children,
  action,
  disabled = false,
  preserveValues = false,
}: {
  children: React.ReactNode;
  action: string;
  disabled?: boolean;
  preserveValues?: boolean;
}) {
  const [state, submit, pending] = useActionState(coreAction, { error: "" });
  return (
    <form
      action={submit}
      className="space-y-4"
      onReset={
        preserveValues
          ? (e) => {
              e.preventDefault();
            }
          : undefined
      }
    >
      <input type="hidden" name="action" value={action} />
      {children}
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      <Button disabled={pending || disabled}>
        {pending
          ? "Saving…"
          : action === "reschedule" ? "Reschedule" : action === "duplicate" ? "Duplicate" : action === "check_channel" ? "Check now" : action === "retry"
            ? "Retry now"
            : action === "skip"
              ? "Skip channel"
              : action === "disconnect"
                ? "Disconnect"
                : action === "connect"
                  ? "Connect channel"
                  : "Create brand"}
      </Button>
    </form>
  );
}
export function BrandForm() {
  return (
    <ActionForm action="brand">
      <label className="block">
        Name
        <Input name="name" required maxLength={80} />
      </label>
      <label className="block">
        Color
        <Input name="color" type="color" defaultValue="#047857" />
      </label>
      <TimezoneSelect />
    </ActionForm>
  );
}
type Option = {
  provider: string;
  fields: ReadonlyArray<{
    key: string;
    label: string;
    help?: string;
    secret: boolean;
    placeholder?: string;
  }>;
};
export function ConnectForm({
  brandId,
  options,
}: {
  brandId: string;
  options: Option[];
}) {
  const [provider, setProvider] = useState(options[0]?.provider ?? "");
  return (
    <ActionForm action="connect" preserveValues>
      <input type="hidden" name="brandId" value={brandId} />
      <label className="block">
        Provider
        <Select
          className="block rounded border p-3"
          name="provider"
          aria-label="Provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.provider}>{o.provider}</option>
          ))}
        </Select>
      </label>
      {options
        .find((o) => o.provider === provider)
        ?.fields.map((f) => (
          <label className="block" key={provider + f.key}>
            {f.label}
            <Input
              name={"credential:" + f.key}
              type={f.secret ? "password" : "text"}
              placeholder={f.placeholder}
              autoComplete="off"
              required
            />
            {f.help && <span className="text-sm text-gray-500">{f.help}</span>}
          </label>
        ))}
    </ActionForm>
  );
}
