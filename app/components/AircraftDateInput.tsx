'use client';
import {useEffect,useId,useRef,useState,type InputHTMLAttributes} from 'react';
import {programToday} from '../../lib/program';
import {aircraftDateInputError,aircraftDateInputValue} from '../../lib/aircraft-date-input';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'|'min'|'max'>&{value:string,onChange:(value:string)=>void,withTime?:boolean,allowFuture?:boolean};
export default function AircraftDateInput({value,onChange,withTime=false,allowFuture=false,readOnly,disabled,...props}:Props){
 const formatted=aircraftDateInputValue(value,withTime),[draft,setDraft]=useState(formatted),[error,setError]=useState(''),[invalid,setInvalid]=useState(false),ref=useRef<HTMLInputElement>(null),errorId=useId();
 useEffect(()=>{setDraft(formatted);setError('');setInvalid(false);ref.current?.setCustomValidity('')},[formatted]);
 function report(message:string,validationMessage=message){setError(message);setInvalid(!!validationMessage);ref.current?.setCustomValidity(validationMessage)}
 // A rejected candidate does not change the displayed draft; validate that draft rather than leaving a stale error.
 function reject(message:string){report('لم يُقبل الإدخال: '+message,aircraftDateInputError(draft,withTime,allowFuture))}
 function accept(raw:string,badInput=false){
  if(readOnly||disabled)return;
  // Native date controls permit extended years. Reject the extra digits before changing aircraft data.
  if(/^\d{5,}-/.test(raw)){reject('السنة يجب أن تتكوّن من أربعة أرقام.');return;}
  setDraft(raw);
  const message=badInput?'أكمل اليوم والشهر والسنة، والوقت إذا كان مطلوبًا.':aircraftDateInputError(raw,withTime,allowFuture);
  report(message);
  // Convert only a complete, valid UTC value; Date must never normalise an impossible date or throw mid-entry.
  if(!message)onChange(raw&&withTime?new Date(raw+'Z').toISOString():raw);
 }
 return <><input {...props} ref={ref} type={withTime?'datetime-local':'date'} value={draft} readOnly={readOnly} disabled={disabled} min={withTime?'1900-01-01T00:00':'1900-01-01'} max={withTime?(allowFuture?'9999-12-31T23:59':new Date().toISOString().slice(0,16)):(allowFuture?'9999-12-31':programToday())} step={withTime?60:undefined} aria-invalid={invalid} aria-describedby={error?errorId:props['aria-describedby']} onChange={e=>accept(e.currentTarget.value,e.currentTarget.validity.badInput)} onBlur={e=>{if(!readOnly&&!disabled)report(e.currentTarget.validity.badInput?'أكمل التاريخ الصحيح قبل الحفظ.':aircraftDateInputError(e.currentTarget.value,withTime,allowFuture))}} onPaste={e=>{
  if(readOnly||disabled)return;
  const text=e.clipboardData.getData('text').trim();
  if(!/^\d{4,}-\d{1,2}-\d{1,2}(?:T.*)?$/.test(text))return;
  e.preventDefault();const message=aircraftDateInputError(text,withTime,allowFuture);
  if(message){reject(message);return;}accept(text);
 }}/>{error&&<small id={errorId} className="error" role="alert">{error}</small>}</>;
}
