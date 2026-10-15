import { useState } from "react";
import { gql } from "@apollo/client";
import { useMutation } from "@apollo/client/react";
import { GoogleLogin } from "@react-oauth/google";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const GOOGLE_LOGIN = gql`
  mutation GoogleLogin($idToken: String!) {
    googleLogin(idToken: $idToken) {
      accessToken
      user { id email displayName onboarded }
      errors { field code message }
    }
  }
`;

type Payload = {
  googleLogin: {
    accessToken: string | null;
    user: { id: string; email: string; displayName: string; onboarded: boolean } | null;
    errors: { field: string | null; code: string; message: string }[];
  };
};

export default function GoogleSignIn() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [googleLogin] = useMutation<Payload>(GOOGLE_LOGIN);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";

  return (
    <div>
      <GoogleLogin
        onSuccess={async (res) => {
          setError(null);
          if (!res.credential) return setError("Google sign-in failed");
          try {
            const { data } = await googleLogin({
              variables: { idToken: res.credential },
              context: { skipRefresh: true },
            });
            const p = data?.googleLogin;
            if (!p || p.errors.length || !p.accessToken || !p.user) {
              return setError(p?.errors[0]?.message ?? "Google sign-in failed");
            }
            signIn(p.accessToken, p.user);
            navigate(from, { replace: true });
          } catch {
            setError("Could not reach the server");
          }
        }}
        onError={() => setError("Google sign-in failed")}
      />
      {error && <p role="alert" style={{ color: "#b91c1c", marginTop: 8, fontSize: 13 }}>{error}</p>}
    </div>
  );
}