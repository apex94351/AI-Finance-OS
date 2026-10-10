"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

type AuthTextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
};

export function AuthTextField({ id, label, ...inputProps }: AuthTextFieldProps) {
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>{label}</label>
      <input className="auth-control" id={id} {...inputProps} />
    </div>
  );
}

type AuthPasswordFieldProps = Omit<AuthTextFieldProps, "type">;

export function AuthPasswordField({ id, label, ...inputProps }: AuthPasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>{label}</label>
      <div className="auth-password-control">
        <input
          className="auth-control"
          id={id}
          type={isVisible ? "text" : "password"}
          {...inputProps}
        />
        <button
          aria-label={isVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          aria-pressed={isVisible}
          className="auth-password-toggle"
          onClick={() => setIsVisible(!isVisible)}
          type="button"
        >
          {isVisible ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
        </button>
      </div>
    </div>
  );
}