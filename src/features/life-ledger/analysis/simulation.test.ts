import assert from 'node:assert/strict';
import { it } from 'node:test';
import { calculateMonthlyLifePlan } from '../calculation';
import { addMonths, yuan } from '../domain';
import { initialWorkspaceState, workspaceReducer } from '../workspace/workspace-reducer';
import { applyPlanPatch, type PlanPatch } from './action-patches';
import { simulateAction, verifyCause } from './simulate-action';
import { createHousingChildOverlapFixture } from './fixtures';

it('all four whitelisted patches calculate a copy without mutating the baseline',()=>{
 const plan=createHousingChildOverlapFixture(), baseline=calculateMonthlyLifePlan(plan), saved=JSON.stringify(plan);
 const patches:PlanPatch[]=[{type:'shift-cash-flow',cashFlowId:plan.standaloneCashFlows[0].id,monthDelta:12},{type:'change-cash-flow-amount',cashFlowId:plan.standaloneCashFlows[1].id,amountCents:yuan(1000)},{type:'change-retirement-month',retirementMonth:addMonths(plan.retirementMonth,12)},{type:'change-liquid-opening-balance',assetId:plan.assets[0].id,openingBalanceCents:yuan(1000000)}];
 for(const patch of patches){const simulation=simulateAction(plan,baseline,patch);assert.deepEqual(simulation.candidateResult,calculateMonthlyLifePlan(applyPlanPatch(plan,patch)));assert.equal(JSON.stringify(plan),saved);}
 assert.throws(()=>applyPlanPatch(plan,{type:'shift-cash-flow',cashFlowId:'missing',monthDelta:1}));
 assert.throws(()=>applyPlanPatch(plan,{type:'shift-cash-flow',cashFlowId:plan.standaloneCashFlows[0].id,monthDelta:-1000}));
 assert.throws(()=>applyPlanPatch(plan,{type:'change-liquid-opening-balance',assetId:plan.assets[0].id,openingBalanceCents:yuan(-1)}));
});
it('applies atomically, rejects stale trials and offers one undo without overwriting subsequent edits',()=>{
 const plan=createHousingChildOverlapFixture(),result=calculateMonthlyLifePlan(plan);
 const state={...initialWorkspaceState,plan,result};
 const trial=simulateAction(plan,result,{type:'change-liquid-opening-balance',assetId:plan.assets[0].id,openingBalanceCents:yuan(1000000)});
 const applied=workspaceReducer(state,{type:'simulation/apply',baselineHash:result.inputHash,candidatePlan:trial.candidatePlan});
 assert.equal(applied.plan,trial.candidatePlan);
 const undone=workspaceReducer(applied,{type:'simulation/undo'});assert.equal(undone.plan,plan);assert.equal(undone.appliedSnapshot,null);
 const changed=workspaceReducer(applied,{type:'plan/edit',updater:(p)=>({...p,name:'Another edit'})});
 assert.equal(workspaceReducer(changed,{type:'simulation/undo'}),changed);
 assert.equal(workspaceReducer(changed,{type:'simulation/apply',baselineHash:result.inputHash,candidatePlan:trial.candidatePlan}),changed);
});
it('causal evidence only asserts a trigger when the first shortfall improves',()=>{
 const plan=createHousingChildOverlapFixture(),result=calculateMonthlyLifePlan(plan);
 const patch:PlanPatch={type:'change-cash-flow-amount',cashFlowId:plan.standaloneCashFlows[0].id,amountCents:yuan(0)};
 const evidence=verifyCause(plan,result,patch);
 const candidate=simulateAction(plan,result,patch).candidateResult;
 assert.equal(evidence.verified,result.summary.firstGapMonth!==null && (candidate.summary.firstGapMonth===null||candidate.summary.firstGapMonth>result.summary.firstGapMonth));
});
