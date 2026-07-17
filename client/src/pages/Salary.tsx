/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { salaryService } from "@/services/salaryService";
import { SalaryResponse } from "@/types";
import { Download, Loader2, Check } from "lucide-react";
import { differenceInMonths, parse, startOfMonth } from "date-fns";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { generatePayslipPDF } from "@/utils/generatePayslipPDF";

const generateYears = () => {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 11 }, (_, i) => currentYear - i);
};

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const Salary = () => {
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const month = `${selectedYear}-${selectedMonth}`;
  const displayMonth = `${monthNames[parseInt(selectedMonth) - 1]} ${selectedYear}`;
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, refetch } = useQuery<SalaryResponse>({
    queryKey: ['salary', month],
    queryFn: () => salaryService.getReport(month),
    enabled: !!month,
  });

  const records = data?.records ?? [];

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      const givenName = (r.givenName || "").toLowerCase();
      const surname = (r.surname || "").toLowerCase();
      const fullName = `${givenName} ${surname}`.trim();
      const employNo = (r.employNo || "").toLowerCase();
      const designation = (r.designation || "").toLowerCase();
      const companyName = (r.companyName || "").toLowerCase();
      return givenName.includes(query) || 
             surname.includes(query) || 
             fullName.includes(query) ||
             employNo.includes(query) || 
             designation.includes(query) ||
             companyName.includes(query);
    });
  }, [records, searchQuery]);

  // Local state for inputs
  const [wpsById, setWpsById] = useState<Record<string, number>>({});
  const [cashById, setCashById] = useState<Record<string, number>>({});
  const [advanceById, setAdvanceById] = useState<Record<string, number>>({}); // Manual Advance
  const [otherById, setOtherById] = useState<Record<string, number>>({}); // Medical/Petty Cash


  useEffect(() => {
    // Reset inputs when loads new data (e.g. month change)
    if (!records) return;

    const newWps: Record<string, number> = {};
    const newCash: Record<string, number> = {};
    const newAdvance: Record<string, number> = {};
    const newOther: Record<string, number> = {};

    records.forEach(r => {
      newWps[r._id] = r.wps ?? 0;
      newCash[r._id] = r.cash ?? 0;
      newAdvance[r._id] = r.advance ?? 0;
      newOther[r._id] = r.otherDeduction ?? 0;
    });

    setWpsById(newWps);
    setCashById(newCash);
    setAdvanceById(newAdvance);
    setOtherById(newOther);
  }, [data]); // Re-run when data (month/year change) updates

  const computedTotals = useMemo(() => {
    const defaultTotals = {
      totalBasicSalary: 0,
      totalAllowance: 0,
      totalSalary: 0,
      totalOtAed: 0,
      totalAbsentDeduction: 0,
      totalAdvanceDeduction: 0,
      totalOtherDeduction: 0,
      totalAdvancePending: 0,
      totalPrevPending: 0,
      totalPayroll: 0, // Total Due
      totalWps: 0,
      totalCash: 0,
      totalPending: 0,
      totalCurrentEarnings: 0,
    };

    if (filteredRecords.length === 0) return defaultTotals;

    return filteredRecords.reduce((acc, r) => {
      const wps = wpsById[r._id] ?? r.wps ?? 0;
      const cash = cashById[r._id] ?? r.cash ?? 0;
      const advances = advanceById[r._id] ?? r.advance ?? 0;
      const other = otherById[r._id] ?? r.otherDeduction ?? 0;
      const prevPending = r.prevPending ?? 0;

      const currentEarnings = (r as any).currentEarnings ?? r.totalSalaryPayable;
      const totalDue = currentEarnings - advances - other + prevPending;

      const totalDebt = (r.advancePending || 0) + (r.advance || 0);
      const liveAdvancePending = Math.max(0, totalDebt - advances);
      const pending = totalDue - (wps + cash);

      acc.totalBasicSalary += r.basicSalary || 0;
      acc.totalAllowance += r.allowance || 0;
      acc.totalSalary += r.totalSalary || 0;
      acc.totalOtAed += r.totalOtAed || 0;
      acc.totalAbsentDeduction += r.absentDeduction || 0;
      acc.totalAdvanceDeduction += advances;
      acc.totalOtherDeduction += other;
      acc.totalAdvancePending += liveAdvancePending;
      acc.totalPrevPending += prevPending;
      acc.totalPayroll += totalDue;
      acc.totalWps += wps;
      acc.totalCash += cash;
      acc.totalPending += pending;
      acc.totalCurrentEarnings += currentEarnings;

      return acc;
    }, defaultTotals);
  }, [filteredRecords, wpsById, cashById, advanceById, otherById]);

  const now = new Date();
  const selectedDate = parse(month, 'yyyy-MM', new Date());
  const currentDate = startOfMonth(new Date());
  const diff = differenceInMonths(currentDate, selectedDate);
  const isEditableMonth = diff >= 0 && diff <= 2;

  // Per-row save status: 'idle' | 'saving' | 'saved' | 'error'
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  const savePaymentClicked = async (workerId: string) => {
    const wps = wpsById[workerId] ?? 0;
    const cash = cashById[workerId] ?? 0;
    const advance = advanceById[workerId];
    const other = otherById[workerId] ?? 0;

    try {
      // Validation Check: Advance cannot exceed Earnings (Client-Side)
      const currentEarnings = (records.find(r => r._id === workerId) as any)?.currentEarnings || 0;
      if (advance > currentEarnings) {
        toast.error("Advance deduction cannot exceed earned amount.");
        return;
      }

      setSaveStatus(prev => ({ ...prev, [workerId]: 'saving' }));

      await salaryService.saveSalary(month, workerId, wps, cash, advance, other);

      setSaveStatus(prev => ({ ...prev, [workerId]: 'saved' }));
      toast.success("Payment saved successfully");
      setTimeout(() => setSaveStatus(prev => ({ ...prev, [workerId]: 'idle' })), 2000);
      refetch();
    } catch (err: any) {
      setSaveStatus(prev => ({ ...prev, [workerId]: 'error' }));
      toast.error(err?.message || 'Failed to save Payment');
    }
  };

  const exportToExcel = async () => {
    try {
      toast.info("Preparing export...");
      const exportRecords = filteredRecords;

      if (exportRecords.length === 0) {
        toast.error("No data to export");
        return;
      }

      const exportData: Array<any> = exportRecords.map((r, i) => {
        const wps = wpsById[r._id] ?? r.wps ?? 0;
        const cash = cashById[r._id] ?? r.cash ?? 0;
        const advances = advanceById[r._id] ?? r.advance ?? 0;
        const other = otherById[r._id] ?? r.otherDeduction ?? 0;
        const prevPending = r.prevPending ?? 0;

        const currentEarnings = (r as any).currentEarnings ?? r.totalSalaryPayable;
        // Total Due = Earnings - Advance(Manual/Calc) - Other(Deduction) + PrevPending
        const totalDue = currentEarnings - advances - other + prevPending;
        const pending = totalDue - (wps + cash);

        return {
          "S/No": i + 1,
          "Given Name": r.givenName,
          "Surname": r.surname,
          "Designation": r.designation || "",
          "Company Name": r.companyName || "AL FAHEEM ELECTROMECHANICAL WORKS",
          "Employ no": r.employNo,
          "Basic": Number(r.basicSalary.toFixed(2)),
          "Allow.": Number(r.allowance.toFixed(2)),
          "Total Sal": Number(r.totalSalary.toFixed(2)),
          "Total HR": r.totalHrInclOT,
          "Normal HR": r.normalHrExcOT,
          "Normal OT (Hrs)": r.normalOtHr,
          "Sunday OT (Hrs)": r.sundayOtHr,
          "Normal OT AED/Hr": Number(r.otAedPerHrNormal.toFixed(2)),
          "Sunday OT AED/Hr": Number(r.otAedPerHrSunday.toFixed(2)),
          "Total OT AED": Number(r.totalOtAed.toFixed(2)),
          "Per Day AED": Number(r.perDayAed.toFixed(2)),
          "Absent (Days)": r.absent,
          "Absent Ded.": Number(r.absentDeduction.toFixed(2)),
          "Earned Amount": Number((r.currentEarnings || 0).toFixed(2)),
          "Advance Deducted": Number(advances.toFixed(2)),
          "Medical/Petty Cash": Number(other.toFixed(2)),
          "Advance Pending": Number((r.advancePending || 0).toFixed(2)),
          "Prev. Pending": Number(prevPending.toFixed(2)),
          "Total Due": Number(totalDue.toFixed(2)),
          "WPS": Number(wps.toFixed(2)),
          "Cash": Number(cash.toFixed(2)),
          "Pending c/f": Number(pending.toFixed(2))
        }
      });

      // Calculate live totals using computedTotals
      exportData.push({
        "S/No": "TOTAL",
        "Given Name": "",
        "Surname": "",
        "Employ no": "",
        "Basic": Number(computedTotals.totalBasicSalary.toFixed(2)),
        "Allow.": Number(computedTotals.totalAllowance.toFixed(2)),
        "Total Sal": Number(computedTotals.totalSalary.toFixed(2)),
        "Total HR": 0,
        "Normal HR": 0,
        "Normal OT (Hrs)": 0,
        "Sunday OT (Hrs)": 0,
        "Normal OT AED/Hr": 0,
        "Sunday OT AED/Hr": 0,
        "Total OT AED": Number(computedTotals.totalOtAed.toFixed(2)),
        "Per Day AED": 0,
        "Absent (Days)": 0,
        "Absent Ded.": Number(computedTotals.totalAbsentDeduction.toFixed(2)),
        "Earned Amount": Number((computedTotals.totalCurrentEarnings || 0).toFixed(2)),
        "Advance Deducted": Number(computedTotals.totalAdvanceDeduction.toFixed(2)),
        "Medical/Petty Cash": Number((computedTotals.totalOtherDeduction || 0).toFixed(2)),
        "Advance Pending": Number((computedTotals.totalAdvancePending || 0).toFixed(2)),
        "Prev. Pending": Number(computedTotals.totalPrevPending.toFixed(2)),
        "Total Due": Number(computedTotals.totalPayroll.toFixed(2)),
        "WPS": Number(computedTotals.totalWps.toFixed(2)),
        "Cash": Number(computedTotals.totalCash.toFixed(2)),
        "Pending c/f": Number(computedTotals.totalPending.toFixed(2)),
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Salary Report");

      const fileName = `Salary_Report_${displayMonth.replace(" ", "_")}.xlsx`;
      const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      saveAs(new Blob([excelBuffer]), fileName);
    } catch (err) {
      console.error(err);
      toast.error("Export failed");
    }
  };



  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Salary Management</h1>
            <p className="text-muted-foreground">Full salary breakdown (Normal & Sunday OT)</p>
          </div>

          <div className="flex gap-3 items-center">
            {/* Month & Year Selector */}
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthNames.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1).padStart(2, '0')}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {generateYears().map(year => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Export Excel */}
            <Button onClick={exportToExcel} variant="default" className="gap-2">
              <Download className="h-4 w-4" />
              Export Excel
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 space-y-0">
            <CardTitle>Salary Breakdown - {displayMonth}</CardTitle>
            <div className="w-full sm:w-72">
              <Input
                placeholder="Search by name, ID, designation..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-96">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <span className="ml-4 text-xl">Loading Salary Report...</span>
              </div>
            ) : records.length === 0 ? (
              <p className="text-center py-12 text-muted-foreground">
                No attendance records for {displayMonth}.
              </p>
            ) : (
              <div className="max-h-[calc(100vh-280px)] overflow-auto sticky-header border rounded-md">
                <Table className="min-w-[2000px]" wrapperClassName="overflow-visible">
                  <TableHeader>
                    <TableRow>
                      <TableHead>S/No</TableHead>
                      <TableHead>Given Name</TableHead>
                      <TableHead>Surname</TableHead>
                      <TableHead>Employ no</TableHead>
                      <TableHead className="text-right">Basic</TableHead>
                      <TableHead className="text-right">Allow.</TableHead>
                      <TableHead className="text-right">Total Sal</TableHead>
                      <TableHead className="text-right bg-blue-50">Total HR</TableHead>
                      <TableHead className="text-right bg-blue-50">Normal HR</TableHead>
                      <TableHead className="text-right bg-blue-100">Normal OT (Hrs)</TableHead>
                      <TableHead className="text-right bg-blue-100">Sunday OT (Hrs)</TableHead>
                      <TableHead className="text-right">Absent(Days)</TableHead>
                      <TableHead className="text-right">Normal OT AED/Hr</TableHead>
                      <TableHead className="text-right">Sunday OT AED/Hr</TableHead>
                      <TableHead className="text-right bg-blue-100">Total OT AED</TableHead>
                      <TableHead className="text-right">Per Day AED</TableHead>
                      <TableHead className="text-right bg-yellow-50">Absent Ded.</TableHead>
                      <TableHead className="text-right bg-green-50">Earned Amount</TableHead>
                      <TableHead className="text-right bg-orange-50">Advance Deducted</TableHead>
                      <TableHead className="text-right bg-orange-50">Medical/Petty Cash</TableHead>
                      <TableHead className="text-right bg-orange-100">Advance Pending</TableHead>
                      <TableHead className="text-right bg-purple-50">Prev. Pending</TableHead>
                      <TableHead className="text-right font-bold">Total Due</TableHead>
                      <TableHead className="text-right">WPS</TableHead>
                      <TableHead className="text-right">Cash</TableHead>
                      <TableHead className="text-right font-bold text-red-600">Pending c/f</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {filteredRecords.map((r, i) => {
                      const wps = wpsById[r._id] ?? r.wps ?? 0;
                      const cash = cashById[r._id] ?? r.cash ?? 0;
                      const advances = advanceById[r._id] ?? r.advance ?? 0;
                      const other = otherById[r._id] ?? r.otherDeduction ?? 0;
                      const prevPending = r.prevPending ?? 0;

                      const currentEarnings = (r as any).currentEarnings ?? r.totalSalaryPayable;
                      // Logic Revert: Medical (other) SUBTRACTS from Total Due
                      const totalDue = currentEarnings - advances - other + prevPending;

                      // Live Advance Pending Calc: 
                      // Original Total Debt = Original Pending Balance + Original Calculated Advance
                      // (Wait, `r.advancePending` from backend is the balance AFTER deduction). 
                      // So Total Debt = r.advancePending + r.advance.
                      // New Pending = Total Debt - New Advance Input (clamped to 0).
                      const totalDebt = (r.advancePending || 0) + (r.advance || 0);
                      const liveAdvancePending = Math.max(0, totalDebt - advances);
                      const pending = totalDue - (wps + cash);

                      return (
                        <TableRow key={r._id}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell>{r.givenName}</TableCell>
                          <TableCell>{r.surname}</TableCell>
                          <TableCell>{r.employNo}</TableCell>
                          <TableCell className="text-right">{r.basicSalary.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{r.allowance.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{r.totalSalary.toFixed(2)}</TableCell>
                          <TableCell className="text-right bg-blue-50">{r.totalHrInclOT}</TableCell>
                          <TableCell className="text-right bg-blue-50">{r.normalHrExcOT}</TableCell>
                          <TableCell className="text-right bg-blue-100">{r.normalOtHr}</TableCell>
                          <TableCell className="text-right bg-blue-100">{r.sundayOtHr}</TableCell>
                          <TableCell className="text-right text-red-600">{r.absent}</TableCell>
                          <TableCell className="text-right">{r.otAedPerHrNormal.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{r.otAedPerHrSunday.toFixed(2)}</TableCell>
                          <TableCell className="text-right bg-blue-100">{r.totalOtAed.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{r.perDayAed.toFixed(2)}</TableCell>
                          <TableCell className="text-right bg-yellow-50">{r.absentDeduction.toFixed(2)}</TableCell>
                          <TableCell className="text-right bg-green-50">
                            {(r.currentEarnings || 0).toFixed(2)}
                          </TableCell>

                          {/* Advance Input - Manual Override */}
                          <TableCell className="text-right bg-orange-50">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!isEditableMonth}
                              value={(advanceById[r._id] ?? r.advance ?? 0).toString()}
                              onChange={(e) =>
                                setAdvanceById(prev => ({ ...prev, [r._id]: Number(e.target.value) || 0 }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && isEditableMonth) savePaymentClicked(r._id);
                              }}
                              className="w-20 text-right p-1 rounded-md border border-slate-200 bg-transparent"
                            />
                          </TableCell>

                          {/* Medical/Petty Cash Input */}
                          <TableCell className="text-right bg-orange-50">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!isEditableMonth}
                              value={(otherById[r._id] ?? r.otherDeduction ?? 0).toString()}
                              onChange={(e) =>
                                setOtherById(prev => ({ ...prev, [r._id]: Number(e.target.value) || 0 }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && isEditableMonth) savePaymentClicked(r._id);
                              }}
                              className="w-20 text-right p-1 rounded-md border border-slate-200 bg-transparent"
                            />
                          </TableCell>

                          <TableCell className="text-right bg-orange-100">
                            {liveAdvancePending > 0 ? liveAdvancePending.toFixed(2) : "-"}
                          </TableCell>

                          <TableCell className="text-right bg-purple-50">
                            {r.prevPending > 0 ? Number(r.prevPending).toFixed(2) : '-'}
                          </TableCell>

                          <TableCell className="text-right font-bold">
                            {totalDue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </TableCell>

                          {/* WPS Input */}
                          <TableCell className="text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={(wpsById[r._id] ?? r.wps ?? 0).toString()}
                              onChange={(e) =>
                                setWpsById(prev => ({ ...prev, [r._id]: Number(e.target.value) || 0 }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') savePaymentClicked(r._id);
                              }}
                              className="w-24 text-right p-1 rounded-md border border-slate-200"
                              placeholder="WPS"
                            />
                          </TableCell>

                          {/* Cash Input */}
                          <TableCell className="text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={(cashById[r._id] ?? r.cash ?? 0).toString()}
                              onChange={(e) =>
                                setCashById(prev => ({ ...prev, [r._id]: Number(e.target.value) || 0 }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') savePaymentClicked(r._id);
                              }}
                              className="w-24 text-right p-1 rounded-md border border-slate-200"
                              placeholder="Cash"
                            />
                          </TableCell>

                          <TableCell className="text-right font-bold text-red-600">
                            {pending.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </TableCell>

                          <TableCell className="text-right space-x-2">
                            <Button
                              size="sm"
                              onClick={() => savePaymentClicked(r._id)}
                              disabled={saveStatus[r._id] === 'saving'}
                              className="gap-2"
                            >
                              {saveStatus[r._id] === 'saving' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : saveStatus[r._id] === 'saved' ? (
                                <Check className="w-4 h-4 text-green-600" />
                              ) : (
                                'Save'
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const wps = wpsById[r._id] ?? r.wps ?? 0;
                                const cash = cashById[r._id] ?? r.cash ?? 0;
                                const advances = advanceById[r._id] ?? r.advance ?? 0;
                                const other = otherById[r._id] ?? r.otherDeduction ?? 0;
                                const prevPending = r.prevPending ?? 0;

                                const currentEarnings = (r as any).currentEarnings ?? r.totalSalaryPayable;
                                const totalDue = currentEarnings - advances - other + prevPending;
                                const pending = totalDue - (wps + cash);

                                generatePayslipPDF({
                                  ...r,
                                  wps,
                                  cash,
                                  advance: advances,
                                  otherDeduction: other,
                                  prevPending,
                                  totalDue,
                                  pending
                                }, displayMonth, (r as any).companyName); // Pass Company Name
                              }}
                              className="gap-1"
                            >
                              <Download className="h-4" />
                              PDF
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {/* TOTAL ROW */}
                    <TableRow className="font-bold bg-muted">
                      <TableCell colSpan={4}>TOTAL</TableCell>
                      <TableCell className="text-right">{computedTotals.totalBasicSalary.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{computedTotals.totalAllowance.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{computedTotals.totalSalary.toFixed(2)}</TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right bg-blue-100">{computedTotals.totalOtAed.toFixed(2)}</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right bg-yellow-50">{computedTotals.totalAbsentDeduction.toFixed(2)}</TableCell>
                      <TableCell className="text-right bg-green-50">
                        {Number(computedTotals.totalCurrentEarnings || 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right bg-orange-50">
                        {Number(computedTotals.totalAdvanceDeduction).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right bg-orange-50">
                        {Number(computedTotals.totalOtherDeduction).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right bg-orange-100">
                        {Number(computedTotals.totalAdvancePending || 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right bg-purple-50">
                        {Number(computedTotals.totalPrevPending).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">{Number(computedTotals.totalPayroll).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{Number(computedTotals.totalWps).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{Number(computedTotals.totalCash).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-red-600">
                        {Number(computedTotals.totalPending).toFixed(2)}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default Salary;