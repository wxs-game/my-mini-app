BEGIN;
-- Abort if the live function changed after the reviewed baseline.
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.emoji_play(text,text,text,integer,numeric,integer[])'::regprocedure)) <> 'e2180b8a9360323ce5c50a3e2076fa0c' THEN
    RAISE EXCEPTION 'emoji_play changed since review; aborting deployment';
  END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public._darts_verdict(p_mode text, p_rolls integer[], p_count integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
-- NULL means that both winning and losing continuations remain possible.
WITH RECURSIVE completions(candidate) AS (
  SELECT p_rolls WHERE p_count BETWEEN 1 AND 3
    AND cardinality(p_rolls) BETWEEN 1 AND p_count
    AND p_rolls <@ ARRAY[1,2,3,4,5,6]
  UNION ALL
  SELECT candidate || r FROM completions CROSS JOIN generate_series(1,6) r
  WHERE cardinality(candidate) < p_count
), outcomes AS (
  SELECT case p_mode
when 'redSector' then candidate[1] in (2,4)
when 'bounce' then candidate[1] = 1
when 'whiteSector' then candidate[1] in (3,5)
when 'center' then candidate[1] = 6
when 'anySector' then candidate[1] between 2 and 5
when 'redCenter' then candidate[1] in (2,4,6)
when 'whiteBounce' then candidate[1] in (1,3,5)
when 'bothBounce' then candidate[1] = 1 and candidate[2] = 1
when 'bothRedSector' then candidate[1] in (2,4) and candidate[2] in (2,4)
when 'bothCenter' then candidate[1] = 6 and candidate[2] = 6
when 'bothWhiteSector' then candidate[1] in (3,5) and candidate[2] in (3,5)
when 'bothRed' then candidate[1] in (2,4,6) and candidate[2] in (2,4,6)
when 'bothWhite' then candidate[1] in (1,3,5) and candidate[2] in (1,3,5)
when 'bothAnySector' then candidate[1] between 2 and 5 and candidate[2] between 2 and 5
when 'noBounce' then candidate[1] <> 1 and candidate[2] <> 1
when 'adjacent' then candidate[1] >= 2 and candidate[2] >= 2 and abs(candidate[1]-candidate[2]) = 1
when 'same' then candidate[1] = candidate[2]
when 'differentColors' then (candidate[1] in (2,4) and candidate[2] in (3,5))
or (candidate[1] in (3,5) and candidate[2] in (2,4))
when 'hasCenter2' then 6 = any(candidate)
when 'firstCloser' then candidate[1] > candidate[2]
when 'secondCloser' then candidate[2] > candidate[1]
when 'threeBounce' then candidate[1] = 1 and candidate[2] = 1 and candidate[3] = 1
when 'threeRedSector' then candidate[1] in (2,4) and candidate[2] in (2,4) and candidate[3] in (2,4)
when 'threeCenter' then candidate[1] = 6 and candidate[2] = 6 and candidate[3] = 6
when 'threeWhiteSector' then candidate[1] in (3,5) and candidate[2] in (3,5) and candidate[3] in (3,5)
when 'threeRed' then candidate[1] in (2,4,6) and candidate[2] in (2,4,6) and candidate[3] in (2,4,6)
when 'threeWhite' then candidate[1] in (1,3,5) and candidate[2] in (1,3,5) and candidate[3] in (1,3,5)
when 'threeAnySector' then candidate[1] between 2 and 5 and candidate[2] between 2 and 5 and candidate[3] between 2 and 5
when 'threeSame' then candidate[1] = candidate[2] and candidate[2] = candidate[3]
when 'trafficLight' then 1 = any(candidate) and 6 = any(candidate)
and (candidate[1] between 2 and 5 or candidate[2] between 2 and 5 or candidate[3] between 2 and 5)
when 'ascending' then candidate[1] < candidate[2] and candidate[2] < candidate[3]
when 'descending' then candidate[1] > candidate[2] and candidate[2] > candidate[3]
when 'thirdCloser' then candidate[3] > candidate[1] and candidate[3] > candidate[2]
when 'hasCenter3' then 6 = any(candidate) end AS won FROM completions WHERE cardinality(candidate) = p_count
)
SELECT CASE WHEN bool_and(won) THEN true WHEN NOT bool_or(won) THEN false ELSE NULL END FROM outcomes;
$$;
REVOKE ALL ON FUNCTION public._darts_verdict(text, integer[], integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.emoji_play(p_init text, p_game text, p_mode text, p_count integer, p_bet numeric, p_nums integer[] DEFAULT '{}'::integer[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
v_id      bigint;
v_wins    int;  v_total int;      -- вероятность одного броска
v_sides   int;                    -- сколько граней у броска
v_wset    int[];                  -- выигрышные номера (не dice)
v_coef    numeric;
v_rolls   int[] := '{}';
v_passes  boolean[] := '{}';
v_verdicts text[] := '{}';
v_symbols jsonb := '[]'::jsonb;
v_base    text;
v_all     boolean := true;
v_pass    boolean; r int; i int; k int;
v_reels   text[]; v_keys text[] := array['bar','grape','lemon','seven'];
v_payout  numeric := 0;
v_bal     numeric;
v_label   text;
begin
-- 1. кто играет: ПОДПИСАННЫЙ initData (та же проверка, что в upgrader_play) ---
v_id := public.mines_auth(p_init);
if v_id is null then raise exception 'Не удалось проверить Telegram-сессию'; end if;

-- 2. валидация ввода -----------------------------------------------------
if p_bet is null or p_bet < 0.10 or round(p_bet, 2) <> p_bet then
raise exception 'Минимальная ставка — 0.10 $'; end if;
if p_count is null or p_count < 1 or p_count > 3 then raise exception 'Неверное число бросков'; end if;

-- 3. параметры игры/режима → вероятность и выигрышные исходы -------------
if p_game = 'dice' then
v_label := 'Куб';
if p_count > 2 then raise exception 'Неверное число кубов'; end if;
v_sides := 6;
if p_mode = 'same' then
if p_count <> 2 then raise exception 'Режим только для 2 кубов'; end if;
v_coef := _emoji_coef(1, 6, 1);
elsif p_mode = 'double' then
if p_count <> 2 then raise exception 'Режим только для 2 кубов'; end if;
elsif p_mode in ('number') then
if p_count > 2 then raise exception 'Неверный режим'; end if;
elsif p_mode in ('high','low','even','odd') then v_wins := 3; v_total := 6;
elsif p_mode in ('center','edges') then
if p_count <> 1 then raise exception 'Режим только для 1 куба'; end if;
v_wins := 2; v_total := 6;
else raise exception 'Неизвестный режим'; end if;
if p_mode in ('number','double') then
select coalesce(array_agg(distinct x), '{}') into p_nums from unnest(p_nums) x where x between 1 and 6;
k := coalesce(array_length(p_nums, 1), 0);
if k < 1 or k > 5 then raise exception 'Выберите от 1 до 5 чисел'; end if;
if p_mode = 'number' then v_coef := _emoji_coef(k, 6, p_count);
else v_coef := _emoji_coef(k, 36, 1); end if;
elsif p_mode <> 'same' then v_coef := _emoji_coef(v_wins, v_total, p_count); end if;

for i in 1..p_count loop
r := _emoji_rand(6);
v_pass := case p_mode
when 'same'   then (i = 1) or r = v_rolls[1]
when 'double' then case when i = 1 then r = any(p_nums) else r = v_rolls[1] end
when 'high'   then r >= 4 when 'low' then r <= 3
when 'even'   then r % 2 = 0 when 'odd' then r % 2 = 1
when 'center' then r in (3,4) when 'edges' then r in (1,6)
when 'number' then r = any(p_nums) end;
v_rolls := v_rolls || r; v_passes := v_passes || v_pass;
if not v_pass then v_all := false; exit; end if;
end loop;

elsif p_game = 'football' then
v_label := 'Футбол'; v_sides := 5;
v_base := regexp_replace(p_mode, '[23]$', '');
if p_mode ~ '2$' and p_count <> 2 or p_mode ~ '3$' and p_count <> 3
or p_mode !~ '[23]$' and p_count <> 1 then raise exception 'Режим не подходит'; end if;
v_wset := case v_base when 'goal' then '{3,4,5}' when 'miss' then '{1,2}' when 'bar' then '{2,4}' end;
if v_wset is null then raise exception 'Неизвестный режим'; end if;
v_coef := _emoji_coef(array_length(v_wset,1), 5, p_count);

elsif p_game = 'darts' and p_mode in ('redSector','bounce','whiteSector','center','anySector','redCenter','whiteBounce','bothBounce','bothRedSector','bothCenter','bothWhiteSector','bothRed','bothWhite','bothAnySector','noBounce','adjacent','same','differentColors','hasCenter2','firstCloser','secondCloser','threeBounce','threeRedSector','threeCenter','threeWhiteSector','threeRed','threeWhite','threeAnySector','threeSame','trafficLight','ascending','descending','thirdCloser','hasCenter3') and (p_count = 1 or p_mode not in ('center','anySector','redCenter','whiteBounce')) then
v_label := 'Дартс'; v_sides := 6;
if (p_count = 1 and p_mode not in ('redSector','bounce','whiteSector','center','anySector','redCenter','whiteBounce'))
or (p_count = 2 and p_mode not in ('bothBounce','bothRedSector','bothCenter','bothWhiteSector','bothRed','bothWhite','bothAnySector','noBounce','adjacent','same','differentColors','hasCenter2','firstCloser','secondCloser'))
or (p_count = 3 and p_mode not in ('threeBounce','threeRedSector','threeCenter','threeWhiteSector','threeRed','threeWhite','threeAnySector','threeSame','trafficLight','ascending','descending','thirdCloser','hasCenter3')) then
raise exception 'Режим не подходит для числа дротиков';
end if;
v_total := power(6, p_count)::int;
v_wins := case p_mode
when 'redSector' then 2 when 'bounce' then 1 when 'whiteSector' then 2
when 'center' then 1 when 'anySector' then 4 when 'redCenter' then 3
when 'whiteBounce' then 3
when 'bothBounce' then 1 when 'bothRedSector' then 4
when 'bothCenter' then 1 when 'bothWhiteSector' then 4
when 'bothRed' then 9 when 'bothWhite' then 9
when 'bothAnySector' then 16 when 'noBounce' then 25
when 'adjacent' then 8 when 'same' then 6 when 'differentColors' then 8
when 'hasCenter2' then 11 when 'firstCloser' then 15 when 'secondCloser' then 15
when 'threeBounce' then 1 when 'threeRedSector' then 8
when 'threeCenter' then 1 when 'threeWhiteSector' then 8
when 'threeRed' then 27 when 'threeWhite' then 27
when 'threeAnySector' then 64 when 'threeSame' then 6
when 'trafficLight' then 24 when 'ascending' then 20
when 'descending' then 20 when 'thirdCloser' then 55 when 'hasCenter3' then 91 end;
v_coef := public._emoji_coef(v_wins, v_total, 1);
-- В двух режимах сравнения первый бросок иногда уже даёт окончательный
-- проигрыш: отскок невозможно сделать «точнее», а центр нельзя перебить.
-- Не генерируем и не возвращаем несуществующий второй бросок.
for i in 1..p_count loop
  v_rolls := v_rolls || public._emoji_rand(6);
  if (p_mode = 'firstCloser' and v_rolls[1] = 1)
     or (p_mode = 'secondCloser' and v_rolls[1] = 6) then
    v_all := false;
    exit;
  end if;
end loop;
v_pass := public._darts_verdict(p_mode, v_rolls, p_count);
v_all := coalesce(v_pass, false);
for i in 1..coalesce(array_length(v_rolls, 1), 0) loop
  v_pass := public._darts_verdict(p_mode, v_rolls[1:i], p_count);
  v_passes := v_passes || (v_pass IS DISTINCT FROM false);
  v_verdicts := v_verdicts || CASE WHEN v_pass IS NULL THEN 'pending' WHEN v_pass THEN 'win' ELSE 'lose' END;
end loop;

elsif p_game in ('basketball','darts','bowling') then
v_label := case p_game when 'basketball' then 'Баскетбол' when 'darts' then 'Дартс' else 'Боулинг' end;
v_sides := case p_game when 'basketball' then 5 else 6 end;
v_wset := case p_game
when 'basketball' then case p_mode
when 'bounce' then '{1}' when 'close' then '{2}' when 'stuck' then '{3}' when 'edge' then '{4}'
when 'clean' then '{5}' when 'spin' then '{2,4}' when 'anyGoal' then '{4,5}' when 'miss' then '{1,2,3}' end
when 'darts' then case p_mode
when 'center' then '{6}' when 'miss' then '{1}' when 's1red' then '{2}' when 's1white' then '{3}'
when 's2red' then '{4}' when 's2white' then '{5}' when 'anySector' then '{2,3,4,5}'
when 'redCenter' then '{2,4,6}' when 'whiteBounce' then '{1,3,5}' end
else case p_mode
when 'miss' then '{1}' when 'pin1' then '{2}' when 'pin3' then '{3}' when 'pin4' then '{4}'
when 'pin5' then '{5}' when 'strike' then '{6}' end end;
if v_wset is null then raise exception 'Неизвестный режим'; end if;
v_coef := _emoji_coef(array_length(v_wset,1), v_sides, p_count);

elsif p_game = 'slots' then
v_label := 'Слоты';
if p_count <> 1 then raise exception 'Слоты — 1 раунд'; end if;
v_wins := case when p_mode in ('seven','lemon','grape','bar') then 1 when p_mode = 'anyCombo' then 4
when p_mode = 'unique' then 24 when p_mode = 'duel' then 36 end;
if v_wins is null then raise exception 'Неизвестный режим'; end if;
v_coef := _emoji_coef(v_wins, 64, 1);
v_reels := array[v_keys[_emoji_rand(4)], v_keys[_emoji_rand(4)], v_keys[_emoji_rand(4)]];
v_pass := case p_mode
when 'anyCombo' then v_reels[1] = v_reels[2] and v_reels[2] = v_reels[3]
when 'unique'   then v_reels[1] <> v_reels[2] and v_reels[2] <> v_reels[3] and v_reels[1] <> v_reels[3]
when 'duel'     then (v_reels[1] = v_reels[2]) <> (v_reels[2] = v_reels[3]) or (v_reels[1] = v_reels[3] and v_reels[1] <> v_reels[2])
else v_reels[1] = p_mode and v_reels[2] = p_mode and v_reels[3] = p_mode end;
v_passes := array[v_pass]; v_all := v_pass;
v_symbols := jsonb_build_array(to_jsonb(v_reels));
else
raise exception 'Неизвестная игра';
end if;

-- 4. броски для футбола / дартса / баскетбола / боулинга -----------------
if p_game in ('football','basketball','darts','bowling') and coalesce(array_length(v_rolls,1),0) = 0 then
for i in 1..p_count loop
r := _emoji_rand(v_sides);
v_pass := r = any(v_wset);
v_rolls := v_rolls || r; v_passes := v_passes || v_pass;
if not v_pass then v_all := false; exit; end if;
end loop;
end if;

v_all := v_all and (p_game = 'slots' or coalesce(array_length(v_rolls,1),0) = p_count);

-- 5. ставка и выплата в ОДНОЙ транзакции (любая ошибка откатывает всё) ----
v_bal := public.place_bet(v_id, p_bet, v_label);
if v_all then
v_payout := floor(round(p_bet * 100) * round(v_coef * 100) / 100) / 100;   -- вниз до цента
v_bal := public.resolve_win(v_id, v_payout, v_coef);
end if;

return jsonb_build_object(
'ok', true, 'win', v_all, 'payout', v_payout, 'coef', v_coef, 'balance', v_bal,
'rolls', to_jsonb(v_rolls), 'passes', to_jsonb(v_passes), 'symbols', v_symbols, 'verdicts', to_jsonb(v_verdicts));
exception when others then
return jsonb_build_object('ok', false, 'error', sqlerrm);
end $function$
;

COMMIT;
