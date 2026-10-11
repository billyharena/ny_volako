begin;
create extension if not exists pgtap with schema extensions;
-- Droit temporaire pour les assertions pgTAP exécutées sous le rôle interne.
grant usage on schema extensions to ny_volako_writer;
select no_plan();
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','a@example.test'),
 ('22222222-2222-4222-8222-222222222222','b@example.test');

select ok(not rolbypassrls and not rolcanlogin, 'Writer cannot log in or bypass RLS') from pg_roles where rolname='ny_volako_writer';
select is(count(*)::integer,5,'All business tables enforce RLS') from pg_class where relnamespace='public'::regnamespace and relname in ('categories','expenses','monthly_budgets','user_settings','sync_receipts') and relrowsecurity and relforcerowsecurity;
select ok(not pg_has_role('authenticated','ny_volako_writer','MEMBER'),'Browser cannot become the writer');
set local role anon;
select throws_ok('select public.initialize_account()','42501',null,'Anonymous bootstrap denied');
select throws_ok('select * from public.expenses','42501',null,'Anonymous reads denied');
select throws_ok($$select public.read_account_page('expenses')$$,'42501',null,'Anonymous RPC reads denied');
select throws_ok($$select public.apply_change(gen_random_uuid(),'categories',gen_random_uuid(),'create','0','{"name":"Anonymous"}')$$,'42501',null,'Anonymous mutations denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select lives_ok('select public.initialize_account()','First account initialized');
select lives_ok('select public.initialize_account()','Repeated initialization succeeds');
select is((select count(*)::integer from public.categories),6,'Defaults are not duplicated');
select is((select currency from public.user_settings),'MGA','Default currency');
select throws_ok($$insert into public.categories(id,user_id,name) values(gen_random_uuid(),auth.uid(),'Forged')$$,'42501',null,'Direct insert denied');
select throws_ok($$update public.user_settings set currency='EUR'$$,'42501',null,'Direct update denied');
select throws_ok($$delete from public.categories$$,'42501',null,'Direct delete denied');
select throws_ok($$update public.sync_receipts set result='{}'$$,'42501',null,'Receipts cannot be forged');
select throws_ok($$select public.read_account_page('expenses',null,501)$$,'22023','invalid_limit','Read page size bounded');

create temporary table test_receipt as select public.apply_change(
 'aaaaaaaa-0000-4000-8000-000000000001','categories','aaaaaaaa-1000-4000-8000-000000000001','create','0','{"name":"Test"}'::jsonb) as receipt;
select is((select receipt->>'status' from test_receipt),'applied','RPC creates category');
select is(public.apply_change('aaaaaaaa-0000-4000-8000-000000000001','categories','aaaaaaaa-1000-4000-8000-000000000001','create','0','{"name":"Test"}'),(select receipt from test_receipt),'Same operation returns exact receipt');
select throws_ok($$select public.apply_change('aaaaaaaa-0000-4000-8000-000000000001','categories','aaaaaaaa-1000-4000-8000-000000000001','create','0','{"name":"Changed"}')$$,'22023','operation_id_reused','Changed operation rejected');
select throws_ok($$select public.apply_change(gen_random_uuid(),'categories',gen_random_uuid(),'create','0','{"name":"Forgery","user_id":"22222222-2222-4222-8222-222222222222"}')$$,'22023','invalid_payload','Forged ownership rejected');

select is(public.apply_change('aaaaaaaa-0000-4000-8000-000000000002','expenses','aaaaaaaa-2000-4000-8000-000000000001','create','0',
 '{"expense_date":"2026-10-11","motif":"Fraction","category_id":"aaaaaaaa-1000-4000-8000-000000000001","unit_price":"1.01","quantity":"0.500","extra_fee":"0"}')#>>'{row,total}', '0.51','Exact rounded total transmitted as string');
select is(jsonb_typeof(public.read_account_page('expenses')->0->'version'),'string','Versions transmitted as strings');
select throws_ok($$select public.apply_change(gen_random_uuid(),'expenses',gen_random_uuid(),'create','0',
 '{"expense_date":"2026-10-11","motif":"Invalid","category_id":"aaaaaaaa-1000-4000-8000-000000000001","unit_price":"1.001","quantity":"1","extra_fee":"0"}')$$,'22023','invalid_money','Excess precision rejected before numeric coercion');
select is(public.apply_change(gen_random_uuid(),'expenses','aaaaaaaa-2000-4000-8000-000000000001','update','2','{}')->>'status','conflict','Stale version cannot overwrite');
select is(public.apply_change(gen_random_uuid(),'expenses','aaaaaaaa-2000-4000-8000-000000000001','delete','1','{}')#>>'{row,version}','2','Delete increments version');
select is(jsonb_array_length(public.read_account_page('expenses')),1,'Tombstone remains visible');
select is(public.apply_change(gen_random_uuid(),'expenses','aaaaaaaa-2000-4000-8000-000000000001','update','2','{}')->>'status','conflict','Deleted expense cannot resurrect');
select throws_ok($$select public.apply_change(gen_random_uuid(),'user_settings',auth.uid(),'update','1','{"currency":"EUR","timezone":"Indian/Antananarivo","theme":"system","locale":"fr"}')$$,'22023','currency_has_history','Currency immutable even with only deleted history');
select is(public.apply_change(gen_random_uuid(),'monthly_budgets','aaaaaaaa-3000-4000-8000-000000000001','create','0','{"month_start":"2026-10-01","budget_limit":"100","warning_thresholds":[70,85,100]}')->>'status','applied','Budget created');
select is(public.apply_change(gen_random_uuid(),'monthly_budgets',gen_random_uuid(),'create','0','{"month_start":"2026-10-01","budget_limit":"200","warning_thresholds":[70,85,100]}')->>'reason','month_already_exists','Duplicate month returns conflict');
select throws_ok($$select public.apply_change(gen_random_uuid(),'monthly_budgets',gen_random_uuid(),'create','0','{"month_start":"2026-11-01","budget_limit":"200","warning_thresholds":[70,70]}')$$,'23514',null,'Duplicate thresholds rejected');

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select lives_ok('select public.initialize_account()','Second account initialized');
select is((select count(*)::integer from public.categories),6,'Second account sees only its defaults');
select is((select count(*)::integer from public.expenses),0,'Second account cannot read first account expenses');
select is((select count(*)::integer from public.sync_receipts),0,'Receipts are isolated');
select throws_ok($$select public.apply_change(gen_random_uuid(),'expenses',gen_random_uuid(),'create','0',
 '{"expense_date":"2026-10-11","motif":"Cross account","category_id":"aaaaaaaa-1000-4000-8000-000000000001","unit_price":"1","quantity":"1","extra_fee":"0"}')$$,'22023','category_unavailable','Cross-account category rejected by RPC');
select is(public.apply_change(gen_random_uuid(),'categories','aaaaaaaa-1000-4000-8000-000000000001','update','1','{"name":"Intrusion"}')->>'status','conflict','Cross-account update cannot find target');
reset role;
-- Even a backend bug cannot insert a cross-account relation.
select throws_ok($$insert into public.expenses(id,user_id,category_id,expense_date,motif,unit_price,quantity) values(gen_random_uuid(),'22222222-2222-4222-8222-222222222222','aaaaaaaa-1000-4000-8000-000000000001','2026-10-11','Cross',1,1)$$,'23503',null,'Composite foreign key enforces ownership');
set local role ny_volako_writer;
select is((select count(*)::integer from public.expenses),0,'Internal writer remains subject to owner RLS');
select throws_ok($$insert into public.categories(id,user_id,name) values(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','Forbidden')$$,'42501',null,'Internal writer cannot forge owner');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok('select public.initialize_account()','42501','authentication_required','Missing JWT identity rejected explicitly');
select * from finish();
rollback;
