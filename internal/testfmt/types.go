package testfmt

import "klats/internal/rich"

// use is a set of the question fields a type keeps. The option fields Correct
// and Target are listed apart from Options because only some types use them.
type use uint16

const (
	useOptions use = 1 << iota
	useCorrect
	useTarget
	useTargets
	useBody
	useGaps
	useImage
	useAreas
	useAccepted
	useMatch
	useNumber
	useRubric
	usePartial
	useShuffle
)

// report adds one finding to a question's problems.
type report func(code, severity string, count int)

// kind is what one question type is made of: the fields it uses, the mode of
// its body, the findings it adds to Problems after the empty text or body that
// every type gets, its answer rules for [Question.CleanAnswer] and the check
// [Decode] makes of the question once its fields are cleaned.
type kind struct {
	uses     use
	bodyMode rich.Mode
	problems func(q Question, add report)
	clean    func(q Question, a Answer) (Answer, bool)
	validate func(q Question) error
}

// kinds holds every question type id.
var kinds = map[string]kind{
	"single":    {uses: useOptions | useCorrect | useShuffle, problems: choiceProblems, clean: cleanPick},
	"multi":     {uses: useOptions | useCorrect | usePartial | useShuffle, problems: choiceProblems, clean: cleanPick},
	"truefalse": {uses: useOptions | useCorrect | usePartial | useShuffle, problems: trueFalseProblems, clean: cleanTrueFalse},
	"grid":      {uses: useOptions | useTarget | useTargets | usePartial | useShuffle, problems: gridProblems, clean: cleanGrid},
	"short":     {uses: useAccepted | useMatch, problems: shortProblems, clean: cleanText},
	"number":    {uses: useNumber, problems: numberProblems, clean: cleanText},
	"gaps":      {uses: useBody | useGaps | useMatch | usePartial, bodyMode: rich.Gapped, problems: gapsProblems, clean: cleanGaps},
	"order":     {uses: useOptions | usePartial, problems: orderProblems, clean: cleanOrder},
	"match":     {uses: useOptions | useTarget | useTargets | usePartial, problems: matchProblems, clean: cleanMatch, validate: checkMatchPairs},
	"groups":    {uses: useOptions | useTarget | useTargets | usePartial, problems: groupsProblems, clean: cleanGrid},
	"bank":      {uses: useBody | useOptions | useTarget | usePartial, bodyMode: rich.Gapped, problems: bankProblems, clean: cleanBank, validate: checkBankWords},
	"hotspot":   {uses: useImage | useAreas},
	"label":     {uses: useImage | useTargets | useOptions | useTarget | usePartial},
	"highlight": {uses: useBody | usePartial, bodyMode: rich.Marked},
	"open":      {uses: useRubric},
}

// dropUnused clears the fields the type does not use.
func (q *Question) dropUnused(u use) {
	if u&useOptions == 0 {
		q.Options = nil
	}
	for i := range q.Options {
		if u&useCorrect == 0 {
			q.Options[i].Correct = false
		}
		if u&useTarget == 0 {
			q.Options[i].Target = ""
		}
	}
	if u&useTargets == 0 {
		q.Targets = nil
	}
	if u&useBody == 0 {
		q.Body = nil
	}
	if u&useGaps == 0 {
		q.Gaps = nil
	}
	if u&useImage == 0 {
		q.Image = nil
	}
	if u&useAreas == 0 {
		q.Areas = nil
	}
	if u&useAccepted == 0 {
		q.Accepted = nil
	}
	if u&useMatch == 0 {
		q.Match = nil
	}
	if u&useNumber == 0 {
		q.Number = nil
	}
	if u&useRubric == 0 {
		q.Rubric = ""
	}
	if u&usePartial == 0 {
		q.Partial = false
	}
	if u&useShuffle == 0 {
		q.ShuffleOptions = false
	}
}

// CleanAnswer returns the answer reduced to the field its type uses, and
// whether the answer is valid for the question: every id it names belongs to
// the question and its values are among those the type allows. A repeated item
// is dropped, except in an ordering answer, which must list every option
// exactly once. An unknown type, or one without answer rules, has no valid
// answer.
func (q Question) CleanAnswer(a Answer) (Answer, bool) {
	k, ok := kinds[q.Type]
	if !ok || k.clean == nil {
		return Answer{}, false
	}
	return k.clean(q, a)
}
