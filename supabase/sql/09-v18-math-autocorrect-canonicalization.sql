-- Mathside V18 — safer math answer canonicalization
-- Run after 08-v17-math-answer-normalization.sql.
-- Fixes common MathLive formatting differences, nested fraction/exponent braces,
-- leading equals signs, and simple negative-exponent equivalences.

create or replace function mathside_private.normalize_math_answer(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_value, '')));
begin
  if v = '' then return ''; end if;

  -- Remove display wrappers / spacing commands.
  v := replace(v, E'\\(', '');
  v := replace(v, E'\\)', '');
  v := replace(v, E'\\[', '');
  v := replace(v, E'\\]', '');
  v := replace(v, '$', '');
  v := replace(v, E'\\left', '');
  v := replace(v, E'\\right', '');
  v := replace(v, E'\\,', '');
  v := replace(v, E'\\;', '');
  v := replace(v, E'\\:', '');
  v := replace(v, E'\\!', '');

  -- Friendly final-answer tolerance: '=1' and '1' mean the same thing.
  v := regexp_replace(v, '^[[:space:]]*=', '');

  -- Equivalent operator characters.
  v := replace(v, '−', '-');
  v := replace(v, '–', '-');
  v := replace(v, '×', '*');
  v := replace(v, '·', '*');
  v := replace(v, '÷', '/');
  v := replace(v, E'\\times', '*');
  v := replace(v, E'\\cdot', '*');
  v := replace(v, E'\\div', '/');

  -- Unicode superscripts.
  v := replace(v, '⁰', '^0'); v := replace(v, '¹', '^1');
  v := replace(v, '²', '^2'); v := replace(v, '³', '^3');
  v := replace(v, '⁴', '^4'); v := replace(v, '⁵', '^5');
  v := replace(v, '⁶', '^6'); v := replace(v, '⁷', '^7');
  v := replace(v, '⁸', '^8'); v := replace(v, '⁹', '^9');

  -- Strip simple style wrappers.
  v := regexp_replace(v, $re$\\mathrm\{([^{}]*)\}$re$, $rep$\1$rep$, 'g');
  v := regexp_replace(v, $re$\\mathit\{([^{}]*)\}$re$, $rep$\1$rep$, 'g');
  v := regexp_replace(v, $re$\\mathbf\{([^{}]*)\}$re$, $rep$\1$rep$, 'g');
  v := regexp_replace(v, $re$\\text\{([^{}]*)\}$re$, $rep$\1$rep$, 'g');

  -- IMPORTANT: simplify exponent/subscript braces BEFORE fractions. MathLive often
  -- emits \\frac{1}{y^{2}}; doing this first turns it into \\frac{1}{y^2},
  -- which the simple fraction rule below can canonicalize correctly.
  v := regexp_replace(v, $re$\^\{([^{}]+)\}$re$, $rep$^\1$rep$, 'g');
  v := regexp_replace(v, $re$_\{([^{}]+)\}$re$, $rep$_\1$rep$, 'g');

  -- Fractions after exponent-brace simplification.
  v := regexp_replace(v, $re$\\dfrac\{([^{}]+)\}\{([^{}]+)\}$re$, $rep$\1/\2$rep$, 'g');
  v := regexp_replace(v, $re$\\frac\{([^{}]+)\}\{([^{}]+)\}$re$, $rep$\1/\2$rep$, 'g');
  -- A second pass catches fractions exposed by the first pass.
  v := regexp_replace(v, $re$\\dfrac\{([^{}]+)\}\{([^{}]+)\}$re$, $rep$\1/\2$rep$, 'g');
  v := regexp_replace(v, $re$\\frac\{([^{}]+)\}\{([^{}]+)\}$re$, $rep$\1/\2$rep$, 'g');

  -- Remove whitespace before algebraic canonicalization.
  v := regexp_replace(v, '[[:space:]]+', '', 'g');

  -- Simple exponent-law equivalences useful for final answers.
  -- y^-2 / y^(-2) -> 1/y^2
  v := regexp_replace(v, '^([a-z][a-z0-9_]*)\^\(-([0-9]+)\)$', '1/\1^\2');
  v := regexp_replace(v, '^([a-z][a-z0-9_]*)\^-([0-9]+)$', '1/\1^\2');
  -- 1/y^-2 -> y^2
  v := regexp_replace(v, '^1/([a-z][a-z0-9_]*)\^\(-([0-9]+)\)$', '\1^\2');
  v := regexp_replace(v, '^1/([a-z][a-z0-9_]*)\^-([0-9]+)$', '\1^\2');
  -- x^0 factors disappear; x^1 becomes x (simple monomial factors only).
  v := regexp_replace(v, '([a-z][a-z0-9_]*)\^0', '', 'g');
  v := regexp_replace(v, '^([a-z][a-z0-9_]*)\^1$', '\1');
  if v = '' then v := '1'; end if;

  return v;
end;
$$;
