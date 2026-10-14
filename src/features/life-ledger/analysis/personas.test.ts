import assert from 'node:assert/strict';
import { it } from 'node:test';
import { calculateMonthlyLifePlan } from '../calculation';
import { addMonths, validateLifePlan, yuan } from '../domain';
import { createPlanBackup, parsePlanBackup } from '../storage/backup';
import { updateCategoryDetail } from '../workspace/plan/plan-mutations';
import { saveCareerChange } from '../workspace/plan/career-mutations';
import { annualChartData } from './chart-data';
import { generateInsights } from './generate-insights';
import { generateActions } from './generate-actions';
import { simulateAction } from './simulate-action';
import { personaPlans, propertyPersona } from './personas';

for(const {id,baseline,plan} of personaPlans())it(`persona ${id}: deterministic calculation, backup and independent trial`,()=>{
 assert.equal(validateLifePlan(plan).valid,true);
 const result=calculateMonthlyLifePlan(plan);
 assert.deepEqual(calculateMonthlyLifePlan(parsePlanBackup(JSON.stringify(createPlanBackup(plan))).plan).monthly,result.monthly);
 assert.equal(annualChartData(result).length,result.annual.length);
 const serialized=JSON.stringify(plan);
 const actions=generateActions(plan,result,generateInsights(plan,result));
 for(const action of actions){const trial=simulateAction(plan,result,action.patch);assert.equal(JSON.stringify(plan),serialized);assert.equal(trial.baselineHash,result.inputHash);}
 if(id==='lin')assert.equal(result.monthly[12].incomeCents,yuan(8000));
 if(id==='chen'){assert.equal(result.monthly[24].incomeCents,yuan(28000));assert.equal(result.monthly[36].incomeCents,yuan(28500));}
 if(id==='zhou'){
  const original=calculateMonthlyLifePlan(baseline);assert.equal(result.monthly[0].netCashFlowCents-original.monthly[0].netCashFlowCents,yuan(-1000));
  assert.deepEqual(calculateMonthlyLifePlan(updateCategoryDetail(plan,'housing',yuan(2000))).monthly.map((r)=>r.expenseCents),result.monthly.map((r)=>r.expenseCents));
 }
 if(id==='xu')assert.equal(result.monthly[24].expenseCents,yuan(817000));
 if(id==='zhao'){const retirement=result.monthly.find((r)=>r.month===plan.retirementMonth)!;assert.equal(retirement.incomeCents,0);assert.equal(retirement.expenseCents,yuan(10000));}
 if(id==='tang'){assert.equal(result.monthly[12].incomeCents,yuan(2000));assert.ok(result.monthly[18].incomeCents>yuan(16000));}
});
it('property persona can have positive net worth without enough available cash',()=>{
 const result=calculateMonthlyLifePlan(propertyPersona());assert.ok(result.monthly.some((r)=>r.closingAvailableCents<0&&r.netWorthCents>0));
});
it('a break within a new job pauses that job without deleting side income',()=>{
 let plan=personaPlans().find((p)=>p.id==='chen')!.plan;
 plan=saveCareerChange(plan,{id:'leave',kind:'break',amount:0,start:addMonths(plan.baseMonth,30),end:addMonths(plan.baseMonth,36),name:'Leave'});
 const r=calculateMonthlyLifePlan(plan);assert.equal(r.monthly[30].incomeCents,yuan(3000));assert.equal(r.monthly[36].incomeCents,yuan(28500));
});
